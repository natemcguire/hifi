'use strict';
// The strip along the bottom of the Echo Show screen that says the stations change: a left
// arrow, "Next or Back to change stations", a right arrow. It sits over whatever the screen
// shows (the station's video or its cover), large and white on near-black so it reads from
// across the room. The arrows are buttons: left is the previous station, right the next, the
// same as saying "Alexa, previous" and "Alexa, next".

const HINT = 'Next or Back to change stations';
const EVENT = 'hifi-dial';

// Two filled triangles, drawn as vector graphics so they look the same on every device.
const graphics = {
  hifiArrowLeft: {
    type: 'AVG', version: '1.2', width: 80, height: 100,
    items: [{ type: 'path', pathData: 'M0,50 L80,0 L80,100 Z', fill: '#FFFFFF' }],
  },
  hifiArrowRight: {
    type: 'AVG', version: '1.2', width: 80, height: 100,
    items: [{ type: 'path', pathData: 'M80,50 L0,0 L0,100 Z', fill: '#FFFFFF' }],
  },
};

// Sizes come from the screen's short side in landscape terms (U: the height of a 16:10 screen
// as wide as this one), so a portrait Echo Show 15 or a round Echo Spot gets the proportions of
// an Echo Show 10 instead of a strip a fifth of a tall screen. Each has a floor from Amazon's
// guidance for screens seen at arm's length and across the room: the arrows are buttons of at
// least 68 dp, the words at least 28 dp.
const U = 'Math.min(viewport.height, viewport.width * 0.625)';
const ROUND = "viewport.shape == 'round'";
// The strip's height, which tv.js also uses to keep the song above it.
const HEIGHT = `\${Math.max(${U} * 0.21, 96)}`;

function arrow(direction) {
  const left = direction === 'previous';
  return {
    type: 'TouchWrapper',
    id: `hifi-${direction}`,
    accessibilityLabel: left ? 'Previous station' : 'Next station',
    role: 'button',
    onPress: [{ type: 'SendEvent', arguments: [EVENT, direction] }],
    item: {
      type: 'Frame', minWidth: 68, minHeight: 68, alignItems: 'center', justifyContent: 'center',
      paddingLeft: `\${Math.max(${U} * 0.03, 12)}`, paddingRight: `\${Math.max(${U} * 0.03, 12)}`,
      item: {
        type: 'VectorGraphic', source: left ? 'hifiArrowLeft' : 'hifiArrowRight', scale: 'best-fit',
        width: `\${Math.max(${U} * 0.11, 44)}`, height: `\${Math.max(${U} * 0.14, 56)}`,
      },
    },
  };
}

// The strip, placed at the bottom over everything else in a full-screen Container. On a round
// screen it is drawn in from the edges and up from the bottom, where the circle would cut it.
function layer() {
  return {
    type: 'Frame', id: 'hifi-dial-hint', position: 'absolute', left: 0, right: 0,
    bottom: `\${${ROUND} ? viewport.height * 0.1 : 0}`,
    height: HEIGHT, backgroundColor: 'rgba(11, 13, 15, 0.88)',
    item: {
      type: 'Container', direction: 'row', alignItems: 'center', justifyContent: 'spaceBetween',
      width: '100%', height: '100%',
      paddingLeft: `\${${ROUND} ? viewport.width * 0.12 : viewport.width * 0.02}`,
      paddingRight: `\${${ROUND} ? viewport.width * 0.12 : viewport.width * 0.02}`,
      items: [
        arrow('previous'),
        {
          type: 'Text', text: HINT, grow: 1, shrink: 1, textAlign: 'center', textAlignVertical: 'center',
          color: '#FFFFFF', fontWeight: 'bold', maxLines: 2,
          fontSize: `\${Math.max(Math.min(${U} * 0.075, viewport.width * 0.045), 28)}`,
        },
        arrow('next'),
      ],
    },
  };
}

// A touch on an arrow: +1 for the next station, -1 for the previous, null for anything else.
function step(request) {
  const args = request?.type === 'Alexa.Presentation.APL.UserEvent' ? request.arguments || [] : [];
  if (args[0] !== EVENT) return null;
  return args[1] === 'next' ? 1 : args[1] === 'previous' ? -1 : null;
}

module.exports = { HINT, EVENT, HEIGHT, graphics, layer, step };
