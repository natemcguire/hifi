'use strict';
// HIFI radio for Alexa. "Alexa, open HIFI radio" plays where you left off; "Alexa, ask HIFI
// radio to play Pop Girl" tunes a station; next and previous move along the dial, like the
// click wheel. Live stations stream straight from the catalog; the synth stations play their
// tracks one after another and queue the next before each one ends.

const Alexa = require('ask-sdk-core');
const catalog = require('./catalog');
const { rank, meaningful } = require('./search');
const store = require('./store');
const tv = require('./tv');
const about = require('./about');
const { log, errorFields } = require('./log');

const DEFAULT_STATION = 'radio-paradise';

// ----- tokens: what the player is holding -----
// Every play gets a token of its own ("live:z100#lq3k9a1"). The Echo Show keeps the title and art
// it showed for a token for up to five days, so a token used again (back to a station heard
// before, or a station whose cover changed) could bring back old art instead of the station now
// playing. The part after # only makes the token new; the station and track are before it.
let plays = 0;
const tokenFor = (station, index) => `${station.stream ? `live:${station.id}` : `track:${station.id}:${index}`}#${Date.now().toString(36)}${(plays++ % 1296).toString(36)}`;
function parseToken(token) {
  const m = /^(live|track):([a-z0-9-]+)(?::(\d+))?(?:#[a-z0-9]+)?$/.exec(token || '');
  return m ? { kind: m[1], id: m[2], index: m[3] ? Number(m[3]) : 0 } : null;
}

// ----- speech -----
// The house stations' names are set in capitals; Alexa reads them better as plain words. A world
// station is said the way its label is written ("Z100", "KEXP"), or the way the catalog's `say`
// spells it out when the label reads badly ("kiss FM" for KIIS FM).
const spoken = station => station.say
  || (station.country && station.label ? station.label.replace(/&/g, 'and').replace(/!+$/, '')
    : station.name.toLowerCase().replace(/!+$/, '').replace(/\blo-fi\b/g, 'lo fi').replace(/\by2k\b/g, 'Y 2 K'));
// What Alexa says whenever a station starts by voice: open, resume, a station by name, next and
// previous all say the same line, so the listener always hears where they are, then one short
// sentence on what it is and where it's from ("This is Classic jazz from Jazz24 in Seattle.").
const announce = station => `Now listening to live radio on HIFI: ${spoken(station)}. ${about.describe(station, spoken)}`.trim();
const and = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;

// ----- playback -----
async function currentStation(envelope, state) {
  const stations = await catalog.stations();
  // HIFI TV on screen first (the station plays inside it), then the player, then where we left off.
  const held = tv.showing(envelope) || parseToken(envelope.context?.AudioPlayer?.token);
  const id = held?.id || state.stationId || DEFAULT_STATION;
  return stations.find(s => s.id === id) || stations.find(s => s.id === DEFAULT_STATION) || stations[0];
}

function play(builder, station, { index = 0, offset = 0, behavior = 'REPLACE_ALL', previous = null, token = tokenFor(station, index) } = {}) {
  const live = Boolean(station.stream);
  if (!live && !station.tracks.length) return builder;
  const track = live ? null : station.tracks[((index % station.tracks.length) + station.tracks.length) % station.tracks.length];
  const url = live ? station.stream : track.src;
  // The Echo Show's Now Playing screen: "HIFI Live Radio" big, the station and where it's from
  // small ("Jazz24 · Seattle"). Both short, so neither runs off the screen.
  const metadata = {
    title: live ? 'HIFI Live Radio' : track.title,
    subtitle: live ? about.line(station) : `${track.artist} · ${station.name}`,
    art: { sources: [{ url: station.cover }] },
    // The full-screen picture behind it, 16:10 so nothing is cropped: the arrows and "Next or
    // Back to change stations" along the bottom (make-covers.py).
    backgroundImage: { sources: [{ url: station.background || station.cover }] },
  };
  return builder.addAudioPlayerPlayDirective(behavior, url, token, offset, previous || undefined, metadata);
}

// ----- the Echo Show screen -----
// On a device with a screen the player's Now Playing screen (the metadata above) is the picture.
// A card in the same response is screen content of the skill's own: it covers the player, and
// with shouldEndSession unset it holds the session open for up to 30 seconds. Switching
// stations in that state moved the audio but left the screen behind until the skill was
// restarted. So a play by voice ends the session and sends no card where there is a screen;
// speakers keep the card, which only shows in the Alexa app. Button presses and the player's own
// requests (PlaybackController, AudioPlayer) may carry neither, so they are left alone.
const hasScreen = envelope => Boolean(envelope.context?.Viewport);
const byVoice = envelope => ['LaunchRequest', 'IntentRequest'].includes(Alexa.getRequestType(envelope));
function answer(handlerInput, { title, text } = {}) {
  const { requestEnvelope, responseBuilder } = handlerInput;
  if (!byVoice(requestEnvelope)) return responseBuilder.getResponse();
  if (title && !hasScreen(requestEnvelope)) responseBuilder.withSimpleCard(title, text);
  return responseBuilder.withShouldEndSession(true).getResponse();
}

// HIFI TV: on an Echo Show that can play video, the station plays inside the skill's own screen
// with its clips (tv.js), not through AudioPlayer, which Alexa won't show anything over. Only
// requests that may carry a screen get one; the player's and the buttons' own requests can't.
const MAY_RENDER = ['LaunchRequest', 'IntentRequest', 'Alexa.Presentation.APL.UserEvent'];
const onTV = (envelope, state) => tv.on(envelope, state) && MAY_RENDER.includes(Alexa.getRequestType(envelope));
const within = (promise, ms) => Promise.race([promise, new Promise(done => setTimeout(done, ms, null))]);
// Questions keep the microphone open only where no HIFI TV is on screen: when a reprompt goes
// unanswered the session ends, and with it the screen and the station playing in it.
function ask(handlerInput, speech, reprompt) {
  const { responseBuilder, requestEnvelope } = handlerInput;
  responseBuilder.speak(speech);
  if (!tv.showing(requestEnvelope)) responseBuilder.reprompt(reprompt);
  return responseBuilder.getResponse();
}

async function tune(handlerInput, station, { speech, index, offset = 0, audioOnly = false } = {}) {
  const { requestEnvelope, responseBuilder } = handlerInput;
  const state = await store.load(requestEnvelope);
  const start = index ?? (station.tracks.length ? Math.floor(Math.random() * station.tracks.length) : 0);
  const token = tokenFor(station, start);
  if (!audioOnly && station.tv.length && onTV(requestEnvelope, state)) {
    // A new screen every time, built for this station, with the session left open (no
    // shouldEndSession) so "next", "pause" and "stop" come back here without the skill's name.
    const now = station.nowPlaying ? await within(catalog.nowPlaying(station), 1200) : null;
    const screen = tv.render(responseBuilder, station, { index: start, now });
    await store.save(requestEnvelope, { ...state, stationId: station.id, token, index: start, offset: 0, screen, tvTrack: 0 });
    if (speech !== null) responseBuilder.speak(speech ?? announce(station));
    return responseBuilder.getResponse();
  }
  await store.save(requestEnvelope, { ...state, stationId: station.id, token, index: start, offset });
  play(responseBuilder, station, { index: start, offset, token });
  if (speech === null) return answer(handlerInput);
  responseBuilder.speak(speech ?? announce(station));
  return answer(handlerInput, { title: 'HIFI Live Radio', text: `Starting up stream\n${about.line(station)}` });
}

async function neighbour(handlerInput, step, speak) {
  const stations = await catalog.stations();
  const state = await store.load(handlerInput.requestEnvelope);
  const here = await currentStation(handlerInput.requestEnvelope, state);
  const at = stations.findIndex(s => s.id === here.id);
  const next = stations[(at + step + stations.length) % stations.length];
  return tune(handlerInput, next, { speech: speak ? announce(next) : null });
}

async function resume(handlerInput, speak) {
  const { requestEnvelope } = handlerInput;
  const state = await store.load(requestEnvelope);
  const station = await currentStation(requestEnvelope, state);
  const screen = tv.showing(requestEnvelope);
  if (screen && station.tracks.length && Alexa.getRequestType(requestEnvelope) === 'IntentRequest'
    && Alexa.getIntentName(requestEnvelope) === 'AMAZON.ResumeIntent') {
    return handlerInput.responseBuilder.addDirective(tv.resume(screen.token)).getResponse();
  }
  const held = parseToken(state.token);
  const sameStation = held && held.id === station.id;
  const index = sameStation && held.kind === 'track' ? held.index : undefined;
  const offset = sameStation && held.kind === 'track' ? state.offset || 0 : 0;
  return tune(handlerInput, station, { speech: speak ? announce(station) : null, index, offset });
}

async function stop(handlerInput, speech) {
  const { requestEnvelope, responseBuilder } = handlerInput;
  const state = await store.load(requestEnvelope);
  const screen = MAY_RENDER.includes(Alexa.getRequestType(requestEnvelope)) && tv.showing(requestEnvelope);
  if (screen) {
    // Pause holds the picture and the sound where they are; stop and cancel close the screen,
    // which ends the station playing in it.
    await store.save(requestEnvelope, { ...state, stationId: screen.id });
    if (!speech) return responseBuilder.addDirective(tv.pause(screen.token)).getResponse();
    // Stop the sound and the picture now, not when the screen times out after the session ends.
    return responseBuilder.addDirective(tv.pause(screen.token)).speak(speech).withShouldEndSession(true).getResponse();
  }
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
  // The voice model offers up to five loose matches. One of them wins when it is among the
  // ranker's best three, and the ranker picks between several ("kiss FM" is five stations);
  // otherwise the ranker's best, and the model's only when the ranker found nothing.
  const byModel = resolved.map(id => stations.find(s => s.id === id)).filter(Boolean);
  const station = ranked.slice(0, 3).find(s => byModel.includes(s)) || ranked[0] || byModel[0] || null;
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
      ? `Welcome. ${announce(station)} Say next for another station, or ask for one by name.`
      : announce(station);
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
      return ask(handlerInput, said ? `I don't have a station for ${said}. Try ${examples}.` : `Which station? Try ${examples}.`,
        'Which station would you like?');
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
    const screen = tv.showing(requestEnvelope);
    if (!screen && (!player || !player.token || player.playerActivity === 'IDLE' || player.playerActivity === 'FINISHED' || player.playerActivity === 'STOPPED')) {
      return ask(handlerInput, "Nothing's playing right now. Say play to start HIFI radio.", 'Say play, or name a station.');
    }
    const state = await store.load(requestEnvelope);
    const station = await currentStation(requestEnvelope, state);
    // On HIFI TV the screen reports which of its tracks is on (tvTrack, counted from the first it played).
    const held = screen
      ? (station.tracks.length ? { kind: 'track', index: ((state.index || 0) + (state.tvTrack || 0)) % station.tracks.length } : null)
      : parseToken(player.token);
    let line;
    if (held?.kind === 'track' && station.tracks[held.index]) {
      const t = station.tracks[held.index];
      line = `This is ${t.title} by ${t.artist}, on ${spoken(station)}.`;
    } else {
      const now = await catalog.nowPlaying(station);
      line = now ? `This is ${now.title}${now.artist ? ` by ${now.artist}` : ''}, on ${spoken(station)}.`
        : `This is ${spoken(station)}. ${station.nowPlaying ? "I couldn't get the song title just now." : "It doesn't publish song titles."}`;
    }
    responseBuilder.speak(line);
    if (screen) return responseBuilder.getResponse();  // ending the session would close the screen
    return answer(handlerInput, { title: station.name, text: line });
  },
};

const ListStationsIntentHandler = {
  canHandle: intent('ListStationsIntent', 'AMAZON.HelpIntent'),
  async handle(handlerInput) {
    const stations = await catalog.stations();
    // The house stations are read out; the world stations are too many to read, so they are
    // counted and a few are named.
    const house = stations.filter(s => !s.country), world = stations.filter(s => s.country);
    const countries = [...new Set(world.map(s => s.country))];
    const examples = countries.slice(0, 3).map(code => world.find(s => s.country === code));  // one each from the first countries
    const speech = world.length
      ? `HIFI radio has ${stations.length} stations. The house stations are ${and(house.map(spoken))}. `
        + `Then there are ${world.length} stations from ${countries.length} countries, like ${and(examples.map(spoken))}. `
        + 'Say play and a station name, a city or a country, or say next to move along the dial.'
      : `HIFI radio has ${stations.length} stations: ${and(house.map(spoken))}. Say play and a station name, or say next to move along the dial.`;
    if (tv.showing(handlerInput.requestEnvelope)) return ask(handlerInput, speech);
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
    return ask(handlerInput, "I didn't catch that. Say play and a station name, like play lo fi beats, or say next.", 'Which station would you like?');
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
      log('warn', 'playback failed', { event: 'playback_failed', playbackError: requestEnvelope.request.error });
    }
    return responseBuilder.getResponse();
  },
};

// "Audio only" turns HIFI TV off for this listener: the plain Now Playing screen, through
// AudioPlayer, which also keeps playing when the screen goes home. "Show the video" turns it on.
const VideoIntentHandler = {
  canHandle: intent('VideoOffIntent', 'VideoOnIntent'),
  async handle(handlerInput) {
    const { requestEnvelope } = handlerInput;
    const video = Alexa.getIntentName(requestEnvelope) === 'VideoOnIntent';
    const state = await store.load(requestEnvelope);
    await store.save(requestEnvelope, { ...state, video });
    const station = await currentStation(requestEnvelope, state);
    if (video && !tv.canShow(requestEnvelope)) return tune(handlerInput, station, { speech: `This device can't show the video. ${announce(station)}` });
    return tune(handlerInput, station, { speech: video ? `HIFI TV. ${announce(station)}` : `Audio only. ${announce(station)} Say show the video to bring the pictures back.` });
  },
};

// The HIFI TV screen talking: its arrows (dial-hint.js), and every half minute a tick that says
// whether the stream plays and which track is on. A stream the screen can't play goes to
// AudioPlayer; a live station's song line is brought up to date.
let dial = null;
try { dial = require('./dial-hint'); } catch { /* the dial strip is optional */ }
const ScreenEventHandler = {
  canHandle: is('Alexa.Presentation.APL.UserEvent'),
  async handle(handlerInput) {
    const { requestEnvelope, responseBuilder } = handlerInput;
    const step = dial?.step(requestEnvelope.request);
    if (step) return neighbour(handlerInput, step, false);
    const said = tv.event(requestEnvelope.request);
    const screen = tv.showing(requestEnvelope);
    if (!said || said.kind !== 'tick' || (screen && screen.id !== said.id)) return responseBuilder.getResponse();
    const station = (await catalog.stations()).find(s => s.id === said.id);
    if (!station) return responseBuilder.getResponse();
    if (said.failed) {
      console.log(`tv: ${station.id} would not play on screen; handing it to AudioPlayer`);
      return tune(handlerInput, station, { speech: null, audioOnly: true });
    }
    if (station.tracks.length) {
      const state = await store.load(requestEnvelope);
      if (state.tvTrack !== said.track) await store.save(requestEnvelope, { ...state, tvTrack: said.track });
      return responseBuilder.getResponse();
    }
    if (station.nowPlaying && screen) responseBuilder.addDirective(tv.song(screen.token, await catalog.nowPlaying(station)));
    return responseBuilder.getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle: is('SessionEndedRequest'),
  handle(handlerInput) {
    const { reason, error } = handlerInput.requestEnvelope.request;
    if (reason === 'ERROR') log('warn', 'session ended with error', { event: 'session_error', sessionError: error });
    return handlerInput.responseBuilder.getResponse();
  },
};

// The screen reporting a fault in the HIFI TV document (a clip or image that won't load, a bad
// value): logged, so a screen that went wrong on someone's Echo Show can be traced afterwards.
const ScreenErrorHandler = {
  canHandle: is('Alexa.Presentation.APL.RuntimeError'),
  handle(handlerInput) {
    const { token, errors } = handlerInput.requestEnvelope.request;
    log('warn', 'screen error', { event: 'screen_error', token, screenErrors: errors });
    return handlerInput.responseBuilder.getResponse();
  },
};

const ExceptionEncounteredHandler = {
  canHandle: is('System.ExceptionEncountered'),
  handle(handlerInput) {
    log('error', 'Alexa reported an exception', { event: 'alexa_exception', request: handlerInput.requestEnvelope.request });
    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle: () => true,
  handle(handlerInput, error) {
    log('error', `skill error: ${error?.message ?? error}`, { event: 'skill_error', requestType: Alexa.getRequestType(handlerInput.requestEnvelope), ...errorFields(error) });
    const type = Alexa.getRequestType(handlerInput.requestEnvelope);
    if (type === 'IntentRequest' || type === 'LaunchRequest') {
      return handlerInput.responseBuilder.speak("Sorry, HIFI radio hit a snag. Try again in a moment.").getResponse();
    }
    return handlerInput.responseBuilder.getResponse();
  },
};

// One line per request and per answer in the Railway log, so a report like "Alexa, next said
// what do you want to play" can be checked against what reached the skill and what it sent back.
// No user or device ids.
const REQUEST_LOG = {
  process(handlerInput) {
    const envelope = handlerInput.requestEnvelope;
    const type = Alexa.getRequestType(envelope);
    const name = type === 'IntentRequest' ? ` ${Alexa.getIntentName(envelope)}` : '';
    const player = envelope.context?.AudioPlayer;
    const session = envelope.session ? (envelope.session.new ? 'new' : 'open') : 'none';
    log('info', `alexa: in ${type}${name} player=${player?.playerActivity || '-'}:${parseToken(player?.token)?.id || '-'}`
      + ` tv=${tv.showing(envelope)?.id || '-'} screen=${hasScreen(envelope) ? 'yes' : 'no'} session=${session}`);
  },
};
const RESPONSE_LOG = {
  process(handlerInput, response) {
    const sent = (response?.directives || []).map(d => {
      const token = d.audioItem?.stream?.token || d.token || '';
      return token ? `${d.type}(${token.replace(/#.*$/, '')})` : d.type;
    });
    log('info', `alexa: out ${sent.join(' ') || 'nothing'} speech=${response?.outputSpeech ? 'yes' : 'no'} end=${response?.shouldEndSession ?? '-'}`);
  },
};

const builder = Alexa.SkillBuilders.custom()
  .addRequestInterceptors(REQUEST_LOG)
  .addResponseInterceptors(RESPONSE_LOG)
  .addRequestHandlers(
    LaunchRequestHandler, PlayStationIntentHandler, PlayAnythingIntentHandler, NextIntentHandler, PreviousIntentHandler,
    StopIntentHandler, WhatsPlayingIntentHandler, ListStationsIntentHandler, NotForRadioIntentHandler, StartOverIntentHandler,
    FallbackIntentHandler, VideoIntentHandler, ScreenEventHandler, PlaybackControllerHandler, AudioPlayerEventHandler,
    SessionEndedRequestHandler, ExceptionEncounteredHandler, ScreenErrorHandler,
  )
  .addErrorHandlers(ErrorHandler)
  .withCustomUserAgent('hifi-radio/1.0');

exports.skill = builder.create();   // for server.js (Railway)
exports.handler = builder.lambda(); // for AWS Lambda / Alexa-hosted
exports.announce = announce;
