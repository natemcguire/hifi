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

function arrow(direction) {
  const left = direction === 'previous';
  return {
    type: 'TouchWrapper',
    id: `hifi-${direction}`,
    accessibilityLabel: left ? 'Previous station' : 'Next station',
    role: 'button',
    onPress: [{ type: 'SendEvent', arguments: [EVENT, direction] }],
    item: {
      type: 'Frame', paddingLeft: '${viewport.height * 0.03}', paddingRight: '${viewport.height * 0.03}',
      item: {
        type: 'VectorGraphic', source: left ? 'hifiArrowLeft' : 'hifiArrowRight', scale: 'best-fit',
        width: '${viewport.height * 0.11}', height: '${viewport.height * 0.14}',
      },
    },
  };
}

// The strip, placed at the bottom over everything else in a full-screen Container.
function layer() {
  return {
    type: 'Frame', id: 'hifi-dial-hint', position: 'absolute', left: 0, right: 0, bottom: 0,
    height: '${viewport.height * 0.21}', backgroundColor: 'rgba(11, 13, 15, 0.88)',
    item: {
      type: 'Container', direction: 'row', alignItems: 'center', justifyContent: 'spaceBetween',
      width: '100%', height: '100%', paddingLeft: '${viewport.width * 0.02}', paddingRight: '${viewport.width * 0.02}',
      items: [
        arrow('previous'),
        {
          type: 'Text', text: HINT, grow: 1, shrink: 1, textAlign: 'center', textAlignVertical: 'center',
          color: '#FFFFFF', fontWeight: 'bold', maxLines: 2,
          fontSize: '${Math.min(viewport.height * 0.075, viewport.width * 0.045)}',
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

module.exports = { HINT, EVENT, graphics, layer, step };
