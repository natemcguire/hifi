'use strict';
// HIFI radio for Alexa. "Alexa, open HIFI radio" plays where you left off; "Alexa, ask HIFI
// radio to play Pop Girl" tunes a station; next and previous move along the dial, like the
// click wheel. Live stations stream straight from the catalog; the synth stations play their
// tracks one after another and queue the next before each one ends.

const Alexa = require('ask-sdk-core');
const catalog = require('./catalog');
const { rank, meaningful } = require('./search');
const store = require('./store');

const DEFAULT_STATION = 'radio-paradise';

// ----- tokens: what the player is holding -----
const tokenFor = (station, index) => station.stream ? `live:${station.id}` : `track:${station.id}:${index}`;
function parseToken(token) {
  const m = /^(live|track):([a-z0-9-]+)(?::(\d+))?$/.exec(token || '');
  return m ? { kind: m[1], id: m[2], index: m[3] ? Number(m[3]) : 0 } : null;
}

// ----- speech -----
// Station names are set in capitals; Alexa reads them better as plain words.
const spoken = station => station.name.toLowerCase().replace(/!+$/, '').replace(/\blo-fi\b/g, 'lo fi').replace(/\by2k\b/g, 'Y 2 K');
const and = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;

// ----- playback -----
async function currentStation(envelope, state) {
  const stations = await catalog.stations();
  const held = parseToken(envelope.context?.AudioPlayer?.token);
  const id = held?.id || state.stationId || DEFAULT_STATION;
  return stations.find(s => s.id === id) || stations.find(s => s.id === DEFAULT_STATION) || stations[0];
}

function play(builder, station, { index = 0, offset = 0, behavior = 'REPLACE_ALL', previous = null } = {}) {
  const live = Boolean(station.stream);
  if (!live && !station.tracks.length) return builder;
  const track = live ? null : station.tracks[((index % station.tracks.length) + station.tracks.length) % station.tracks.length];
  const url = live ? station.stream : track.src;
  const metadata = {
    title: live ? station.name : track.title,
    subtitle: live ? station.genre || station.tagline : `${track.artist} · ${station.name}`,
    art: { sources: [{ url: station.cover }] },
    backgroundImage: { sources: [{ url: station.cover }] },
  };
  return builder.addAudioPlayerPlayDirective(behavior, url, tokenFor(station, index), offset, previous || undefined, metadata);
}

async function tune(handlerInput, station, { speech, index, offset = 0 } = {}) {
  const { requestEnvelope, responseBuilder } = handlerInput;
  const state = await store.load(requestEnvelope);
  const start = index ?? (station.tracks.length ? Math.floor(Math.random() * station.tracks.length) : 0);
  await store.save(requestEnvelope, { ...state, stationId: station.id, token: tokenFor(station, start), index: start, offset });
  play(responseBuilder, station, { index: start, offset });
  if (speech !== null) {
    responseBuilder.speak(speech ?? spoken(station)).withSimpleCard(station.name, station.tagline || station.genre);
  }
  return responseBuilder.getResponse();
}

async function neighbour(handlerInput, step, speak) {
  const stations = await catalog.stations();
  const state = await store.load(handlerInput.requestEnvelope);
  const here = await currentStation(handlerInput.requestEnvelope, state);
  const at = stations.findIndex(s => s.id === here.id);
  const next = stations[(at + step + stations.length) % stations.length];
  return tune(handlerInput, next, { speech: speak ? spoken(next) : null });
}

async function resume(handlerInput, speak) {
  const { requestEnvelope } = handlerInput;
  const state = await store.load(requestEnvelope);
  const station = await currentStation(requestEnvelope, state);
  const held = parseToken(state.token);
  const sameStation = held && held.id === station.id;
  const index = sameStation && held.kind === 'track' ? held.index : undefined;
  const offset = sameStation && held.kind === 'track' ? state.offset || 0 : 0;
  return tune(handlerInput, station, { speech: speak ? spoken(station) : null, index, offset });
}

async function stop(handlerInput, speech) {
  const { requestEnvelope, responseBuilder } = handlerInput;
  const state = await store.load(requestEnvelope);
  const offset = requestEnvelope.context?.AudioPlayer?.offsetInMilliseconds || 0;
  const token = requestEnvelope.context?.AudioPlayer?.token || state.token;
  await store.save(requestEnvelope, { ...state, token, offset });
  responseBuilder.addAudioPlayerStopDirective();
  if (speech) responseBuilder.speak(speech);
  return responseBuilder.getResponse();
}

// ----- matching what was said to a station -----
function requestedStation(handlerInput, stations) {
  const slot = Alexa.getSlot(handlerInput.requestEnvelope, 'station');
  if (!slot) return { said: '', station: null };
  const said = slot.value || '';
  const resolved = (slot.resolutions?.resolutionsPerAuthority || [])
    .flatMap(r => r.status?.code === 'ER_SUCCESS_MATCH' ? r.values.map(v => v.value.id) : []);
  const ranked = rank(stations, said);
  // The voice model's own match wins when the ranker agrees it's plausible; otherwise the ranker.
  const byModel = resolved.map(id => stations.find(s => s.id === id)).filter(Boolean);
  const station = byModel.find(s => ranked.slice(0, 3).includes(s)) || ranked[0] || byModel[0] || null;
  return { said, station };
}

const is = (type) => handlerInput => Alexa.getRequestType(handlerInput.requestEnvelope) === type;
const intent = (...names) => handlerInput => Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' && names.includes(Alexa.getIntentName(handlerInput.requestEnvelope));

const LaunchRequestHandler = {
  canHandle: is('LaunchRequest'),
  async handle(handlerInput) {
    const state = await store.load(handlerInput.requestEnvelope);
    const station = await currentStation(handlerInput.requestEnvelope, state);
    const first = !state.stationId;
    const speech = first
      ? `Welcome to HIFI radio. Here's ${spoken(station)}. Say next for another station, or ask for one by name.`
      : `${spoken(station)}.`;
    const held = parseToken(state.token);
    const index = !first && held?.kind === 'track' && held.id === station.id ? held.index : undefined;
    return tune(handlerInput, station, { speech, index, offset: index === undefined ? 0 : state.offset || 0 });
  },
};

const PlayStationIntentHandler = {
  canHandle: intent('PlayStationIntent'),
  async handle(handlerInput) {
    const stations = await catalog.stations();
    const { said, station } = requestedStation(handlerInput, stations);
    if (!station && !meaningful(said)) return resume(handlerInput, true);  // "play something": carry on
    if (!station) {
      const examples = and(stations.slice(0, 3).map(spoken));
      return handlerInput.responseBuilder
        .speak(said ? `I don't have a station for ${said}. Try ${examples}.` : `Which station? Try ${examples}.`)
        .reprompt('Which station would you like?').getResponse();
    }
    return tune(handlerInput, station);
  },
};

const PlayAnythingIntentHandler = {
  canHandle: intent('PlayAnythingIntent', 'AMAZON.ResumeIntent'),
  handle: handlerInput => resume(handlerInput, true),
};

const NextIntentHandler = { canHandle: intent('AMAZON.NextIntent', 'NextStationIntent'), handle: h => neighbour(h, 1, true) };
const PreviousIntentHandler = { canHandle: intent('AMAZON.PreviousIntent', 'PreviousStationIntent'), handle: h => neighbour(h, -1, true) };

const StopIntentHandler = {
  canHandle: intent('AMAZON.PauseIntent', 'AMAZON.StopIntent', 'AMAZON.CancelIntent'),
  handle: handlerInput => stop(handlerInput, Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.PauseIntent' ? undefined : 'Bye.'),
};

const WhatsPlayingIntentHandler = {
  canHandle: intent('WhatsPlayingIntent'),
  async handle(handlerInput) {
    const { requestEnvelope, responseBuilder } = handlerInput;
    const player = requestEnvelope.context?.AudioPlayer;
    if (!player || !player.token || player.playerActivity === 'IDLE' || player.playerActivity === 'FINISHED' || player.playerActivity === 'STOPPED') {
      return responseBuilder.speak("Nothing's playing right now. Say play to start HIFI radio.").reprompt('Say play, or name a station.').getResponse();
    }
    const state = await store.load(requestEnvelope);
    const station = await currentStation(requestEnvelope, state);
    const held = parseToken(player.token);
    let line;
    if (held?.kind === 'track' && station.tracks[held.index]) {
      const t = station.tracks[held.index];
      line = `This is ${t.title} by ${t.artist}, on ${spoken(station)}.`;
    } else {
      const now = await catalog.nowPlaying(station);
      line = now ? `This is ${now.title}${now.artist ? ` by ${now.artist}` : ''}, on ${spoken(station)}.`
        : `This is ${spoken(station)}. ${station.nowPlaying ? "I couldn't get the song title just now." : "It doesn't publish song titles."}`;
    }
    return responseBuilder.speak(line).withSimpleCard(station.name, line).getResponse();
  },
};

const ListStationsIntentHandler = {
  canHandle: intent('ListStationsIntent', 'AMAZON.HelpIntent'),
  async handle(handlerInput) {
    const stations = await catalog.stations();
    const names = stations.map(spoken);
    const speech = `HIFI radio has ${stations.length} stations: ${and(names)}. Say play and a station name, or say next to move along the dial.`;
    return handlerInput.responseBuilder.speak(speech).reprompt('Which station would you like?')
      .withSimpleCard('HIFI radio', stations.map(s => `${s.name} — ${s.genre}`).join('\n')).getResponse();
  },
};

const NotForRadioIntentHandler = {
  canHandle: intent('AMAZON.LoopOnIntent', 'AMAZON.LoopOffIntent', 'AMAZON.ShuffleOnIntent', 'AMAZON.ShuffleOffIntent', 'AMAZON.RepeatIntent'),
  handle: handlerInput => handlerInput.responseBuilder.speak("HIFI is radio, so it just plays. Say next for another station.").getResponse(),
};

const StartOverIntentHandler = {
  canHandle: intent('AMAZON.StartOverIntent'),
  async handle(handlerInput) {
    const state = await store.load(handlerInput.requestEnvelope);
    const station = await currentStation(handlerInput.requestEnvelope, state);
    const held = parseToken(handlerInput.requestEnvelope.context?.AudioPlayer?.token || state.token);
    if (held?.kind === 'track' && held.id === station.id) return tune(handlerInput, station, { index: held.index, speech: null });
    return handlerInput.responseBuilder.speak(`${spoken(station)} is live, so there's no start. Say next for another station.`).getResponse();
  },
};

const FallbackIntentHandler = {
  canHandle: intent('AMAZON.FallbackIntent', 'AMAZON.NavigateHomeIntent'),
  handle(handlerInput) {
    // An unrecognised first utterance ("open hifi radio" heard oddly) still means: play.
    if (handlerInput.requestEnvelope.session?.new) return LaunchRequestHandler.handle(handlerInput);
    return handlerInput.responseBuilder
      .speak("I didn't catch that. Say play and a station name, like play lo fi beats, or say next.")
      .reprompt('Which station would you like?').getResponse();
  },
};

// Buttons on the device or a remote: no speech allowed in these responses.
const PlaybackControllerHandler = {
  canHandle: handlerInput => Alexa.getRequestType(handlerInput.requestEnvelope).startsWith('PlaybackController.'),
  handle(handlerInput) {
    switch (Alexa.getRequestType(handlerInput.requestEnvelope)) {
      case 'PlaybackController.PlayCommandIssued': return resume(handlerInput, false);
      case 'PlaybackController.PauseCommandIssued': return stop(handlerInput);
      case 'PlaybackController.NextCommandIssued': return neighbour(handlerInput, 1, false);
      case 'PlaybackController.PreviousCommandIssued': return neighbour(handlerInput, -1, false);
      default: return handlerInput.responseBuilder.getResponse();
    }
  },
};

// The player telling us where it is. No speech here either.
const AudioPlayerEventHandler = {
  canHandle: handlerInput => Alexa.getRequestType(handlerInput.requestEnvelope).startsWith('AudioPlayer.'),
  async handle(handlerInput) {
    const { requestEnvelope, responseBuilder } = handlerInput;
    const type = Alexa.getRequestType(requestEnvelope);
    const token = requestEnvelope.request.token;
    const offset = requestEnvelope.request.offsetInMilliseconds || 0;
    const held = parseToken(token);
    const state = await store.load(requestEnvelope);
    if (type === 'AudioPlayer.PlaybackStarted' && held) {
      await store.save(requestEnvelope, { ...state, stationId: held.id, token, index: held.index, offset: 0 });
    } else if (type === 'AudioPlayer.PlaybackStopped' && held) {
      await store.save(requestEnvelope, { ...state, stationId: held.id, token, index: held.index, offset });
    } else if ((type === 'AudioPlayer.PlaybackNearlyFinished' || type === 'AudioPlayer.PlaybackFailed') && held?.kind === 'track') {
      const station = (await catalog.stations()).find(s => s.id === held.id);
      if (station?.tracks.length) {
        const index = (held.index + 1) % station.tracks.length;
        play(responseBuilder, station, { index, behavior: type === 'AudioPlayer.PlaybackFailed' ? 'REPLACE_ALL' : 'ENQUEUE', previous: token });
      }
    } else if (type === 'AudioPlayer.PlaybackFailed') {
      console.log('playback failed:', JSON.stringify(requestEnvelope.request.error));
    }
    return responseBuilder.getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle: is('SessionEndedRequest'),
  handle(handlerInput) {
    const { reason, error } = handlerInput.requestEnvelope.request;
    if (reason === 'ERROR') console.log('session ended with error:', JSON.stringify(error));
    return handlerInput.responseBuilder.getResponse();
  },
};

const ExceptionEncounteredHandler = {
  canHandle: is('System.ExceptionEncountered'),
  handle(handlerInput) {
    console.log('system exception:', JSON.stringify(handlerInput.requestEnvelope.request));
    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle: () => true,
  handle(handlerInput, error) {
    console.log('error:', error.stack || error);
    const type = Alexa.getRequestType(handlerInput.requestEnvelope);
    if (type === 'IntentRequest' || type === 'LaunchRequest') {
      return handlerInput.responseBuilder.speak("Sorry, HIFI radio hit a snag. Try again in a moment.").getResponse();
    }
    return handlerInput.responseBuilder.getResponse();
  },
};

const builder = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler, PlayStationIntentHandler, PlayAnythingIntentHandler, NextIntentHandler, PreviousIntentHandler,
    StopIntentHandler, WhatsPlayingIntentHandler, ListStationsIntentHandler, NotForRadioIntentHandler, StartOverIntentHandler,
    FallbackIntentHandler, PlaybackControllerHandler, AudioPlayerEventHandler, SessionEndedRequestHandler, ExceptionEncounteredHandler,
  )
  .addErrorHandlers(ErrorHandler)
  .withCustomUserAgent('hifi-radio/1.0');

exports.skill = builder.create();   // for server.js (Railway)
exports.handler = builder.lambda(); // for AWS Lambda / Alexa-hosted
