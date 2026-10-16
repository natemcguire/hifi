#!/usr/bin/env python3
"""Reproduce original HIFI instrumentals with NumPy + ffmpeg, no samples.

Default renders the 21 expanded-catalog songs without overwriting existing files.
Use --legacy to render the first three long tracks; --overwrite is explicit.
The original seed recordings are never generated or overwritten by this script.
"""
from pathlib import Path
import subprocess, tempfile, wave
import numpy as np
SR=32000
ROOT=Path(__file__).resolve().parents[1]
def render(name,bpm,roots,kind,seed):
    rng=np.random.default_rng(seed); beat=60/bpm; bars=48; duration=bars*4*beat+4
    mix=np.zeros((int(duration*SR),2),dtype=np.float32)
    def put(sound,start,amp=1,pan=0):
        i=int(start*SR); n=min(len(sound),len(mix)-i)
        if n<=0:return
        mix[i:i+n,0]+=sound[:n]*amp*np.sqrt((1-pan)/2)
        mix[i:i+n,1]+=sound[:n]*amp*np.sqrt((1+pan)/2)
    def note(midi,dur,voice='keys'):
        t=np.arange(int(dur*SR))/SR; f=440*2**((midi-69)/12)
        if voice=='pad':
            s=sum(np.sin(2*np.pi*f*r*t)*a for r,a in [(0.998,0.4),(1.002,0.4),(2,0.15),(3,0.05)])
            env=np.minimum(t/.6,1)*np.minimum((dur-t)/.8,1)
        elif voice=='bass':
            s=np.sin(2*np.pi*f*t)+.23*np.sin(4*np.pi*f*t);env=np.minimum(t/.012,1)*np.exp(-t*2.5)*np.minimum((dur-t)/.07,1)
        else:
            s=np.sin(2*np.pi*f*t+1.7*np.sin(2*np.pi*f*2*t)*np.exp(-t*5))+.12*np.sin(2*np.pi*f*3*t)
            env=np.minimum(t/.009,1)*np.exp(-t*(2 if voice=='keys' else 3.5))*np.minimum((dur-t)/.1,1)
        return (s*env).astype(np.float32)
    def drum(typ):
        d=.45 if typ=='kick' else .22;t=np.arange(int(d*SR))/SR
        if typ=='kick':return np.sin(2*np.pi*(48*t+7*(1-np.exp(-t*28))))*np.exp(-t*13)
        noise=rng.normal(0,1,len(t));noise=np.concatenate(([0],np.diff(noise)))
        return noise*np.exp(-t*(65 if typ=='hat' else 23))*(.22 if typ=='hat' else .32)
    motif=[0,7,10,14,12,7,3,2]
    for bar in range(bars):
        root=roots[(bar//2)%len(roots)]; base=bar*4*beat
        section=bar//8; full=4<=bar<44; bridge=24<=bar<32
        chord=[root+12,root+15,root+19,root+22] if kind!='funk' else [root+12,root+16,root+19,root+23]
        for j,pitch in enumerate(chord):put(note(pitch,4*beat+.8,'pad'),base,.055 if kind=='ambient' else .025,(j-1.5)/2)
        if kind!='ambient':
            for step in ([0,1.5,2.75] if kind=='lofi' else [0,.75,1.5,2.5,3.25]):
                for j,pitch in enumerate(chord):put(note(pitch,1.5*beat),base+step*beat,.067 if full else .04,(j-1.5)/3)
        for step in ([0,2,3.5] if kind!='ambient' else [0]):
            put(note(root-12 if kind!='ambient' else root,beat*1.3,'bass'),base+step*beat,.23 if full else .12)
        if full and not bridge:
            if kind!='ambient':
                for step in [0,1.75,2.5]:put(drum('kick'),base+step*beat,.34)
                for step in [1,3]:put(drum('snare'),base+step*beat,.25,-.1)
                for step in np.arange(0,4,.5):put(drum('hat'),base+(step+(.065 if step%1 else 0))*beat,.28 if step%1 else .4,.45)
            elif bar%2==0:put(drum('kick'),base,.12)
        if bar>=8 and bar<44:
            steps=[.5,1.5,2.25,3.5] if kind!='ambient' else [.5,2.5]
            for j,step in enumerate(steps):
                pitch=root+24+motif[(bar+j+(4 if section%2 else 0))%8]
                sound=note(pitch,beat*(2.3 if kind=='ambient' else 1.2),'bell')
                put(sound,base+step*beat,.08 if kind=='ambient' else .09,-.25)
                put(sound,base+(step+.75)*beat,.027,.6)
    # Subtle stereo room echoes, controlled peak, and gentle album-style boundaries.
    for delay,level in [(.117,.09),(.231,.065),(.379,.035)]:
        shift=int(delay*SR);mix[shift:]+=mix[:-shift,::-1].copy()*level
    fade=int(3*SR);mix[:fade]*=np.linspace(0,1,fade)[:,None];mix[-fade:]*=np.linspace(1,0,fade)[:,None]
    mix=np.tanh(mix*1.4);mix*=.88/max(float(np.max(np.abs(mix))),.01)
    with tempfile.TemporaryDirectory() as temp:
        wav=Path(temp)/'song.wav'
        with wave.open(str(wav),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes((mix*32767).astype('<i2').tobytes())
        subprocess.run(['ffmpeg','-y','-v','error','-i',str(wav),'-codec:a','libmp3lame','-b:a','160k',str(ROOT/'tracks'/name)],check=True)
    print(name,round(duration,3))


# Each score has its own harmony, tempo and melodic contour. Seeds affect only
# percussion and gentle performance variation; there are no third-party samples.
SCORES = [
    ('dial-up', 4, 'Window Seat at 2 AM', 78, [48, 44, 53, 46], [0, 2, 4, 3, 1, 5, 4, 2], 'lofi', 2801),
    ('dial-up', 5, 'Waiting for the Green Light', 86, [50, 55, 48, 53], [4, 2, 1, 0, 2, 3, 5, 4], 'lofi', 2802),
    ('dial-up', 6, 'A Folder Full of Rain', 74, [45, 48, 41, 43], [0, 1, 3, 4, 6, 4, 3, 1], 'lofi', 2803),
    ('dial-up', 7, 'Soft Return', 90, [53, 46, 51, 48], [2, 4, 5, 3, 4, 2, 1, 0], 'lofi', 2804),
    ('dial-up', 8, 'Someone Left the Radio On', 80, [47, 43, 50, 45], [4, 5, 7, 6, 4, 2, 3, 1], 'lofi', 2805),
    ('shareware-summer', 3, 'Free Trial of a Perfect Day', 108, [48, 53, 55, 50], [0, 2, 4, 5, 4, 2, 1, 3], 'funk', 2811),
    ('shareware-summer', 4, 'Palm Trees in the Taskbar', 116, [50, 55, 57, 52], [4, 6, 5, 4, 2, 3, 1, 0], 'funk', 2812),
    ('shareware-summer', 5, 'The Afternoon Is Yours', 100, [53, 58, 55, 60], [0, 1, 2, 4, 3, 5, 4, 2], 'funk', 2813),
    ('shareware-summer', 6, 'Lemonade on the Desktop', 112, [55, 50, 53, 48], [2, 4, 6, 4, 5, 3, 2, 0], 'funk', 2814),
    ('shareware-summer', 7, 'Golden Hour, No Expiry', 104, [52, 57, 59, 54], [4, 3, 2, 0, 1, 2, 4, 6], 'funk', 2815),
    ('night-build', 3, 'Blue Light Beyond the Glass', 64, [45, 41, 48, 43], [0, 4, 2, 6, 4, 1, 3, 2], 'ambient', 2821),
    ('night-build', 4, 'An Empty Terminal', 70, [48, 43, 46, 41], [4, 2, 0, 3, 1, 5, 4, 2], 'ambient', 2822),
    ('night-build', 5, 'Satellites Above the Server Room', 76, [50, 46, 53, 48], [0, 3, 5, 4, 2, 6, 3, 1], 'ambient', 2823),
    ('night-build', 6, 'No One Is Typing', 68, [43, 39, 46, 41], [2, 4, 1, 0, 3, 5, 2, 4], 'ambient', 2824),
    ('night-build', 7, 'The Last Process Goes to Sleep', 60, [47, 43, 50, 45], [4, 1, 3, 0, 2, 5, 3, 1], 'ambient', 2825),
    ('pixel-drift', 1, 'Insert Another Afternoon', 120, [48, 53, 55, 50], [0, 2, 4, 7, 6, 4, 2, 1], 'chip', 2831),
    ('pixel-drift', 2, 'Save Point by the Sea', 128, [50, 55, 57, 52], [4, 2, 5, 3, 6, 4, 1, 0], 'chip', 2832),
    ('pixel-drift', 3, 'Clouds Above Level Seven', 112, [53, 48, 50, 55], [0, 1, 3, 5, 7, 5, 4, 2], 'chip', 2833),
    ('pixel-drift', 4, 'A Friendly Final Boss', 124, [45, 50, 48, 43], [2, 4, 6, 7, 5, 3, 4, 1], 'chip', 2834),
    ('pixel-drift', 5, 'Pocket-Sized Horizon', 132, [55, 60, 57, 50], [4, 6, 4, 2, 3, 5, 2, 0], 'chip', 2835),
    ('pixel-drift', 6, 'Continue Without Coins', 116, [52, 57, 59, 54], [0, 4, 2, 5, 3, 7, 6, 4], 'chip', 2836),
]


def render_score(score, overwrite=False):
    station, number, title, bpm, roots, motif, kind, seed = score
    destination = ROOT / 'tracks' / f'{station}-track-{number}.mp3'
    if destination.exists() and not overwrite:
        print(f'Keeping existing {destination.name}', flush=True)
        return destination
    rng = np.random.default_rng(seed)
    beat = 60 / bpm
    bars = max(32, round((120 / (4 * beat)) / 8) * 8)
    duration = bars * 4 * beat + 3
    mix = np.zeros((int(duration * SR), 2), dtype=np.float32)
    tones = {}

    def put(sound, start, level=1, pan=0):
        offset = max(0, int(start * SR))
        count = min(len(sound), len(mix) - offset)
        if count <= 0:
            return
        mix[offset:offset + count, 0] += sound[:count] * level * np.sqrt((1 - pan) / 2)
        mix[offset:offset + count, 1] += sound[:count] * level * np.sqrt((1 + pan) / 2)

    def tone(midi, length, voice):
        key = (midi, round(length, 4), voice)
        if key in tones:
            return tones[key]
        t = np.arange(int(length * SR), dtype=np.float32) / SR
        frequency = 440 * 2 ** ((midi - 69) / 12)
        phase = 2 * np.pi * frequency * t
        release = np.minimum((length - t) / min(.18, length * .3), 1)
        if voice == 'pad':
            sound = .48 * np.sin(phase * .999) + .48 * np.sin(phase * 1.001)
            sound += .09 * np.sin(phase * 2) + .035 * np.sin(phase * 3)
            envelope = np.minimum(t / .65, 1) * np.minimum((length - t) / .9, 1)
        elif voice == 'bass':
            sound = np.sin(phase) + .18 * np.sin(phase * 2)
            envelope = np.minimum(t / .009, 1) * np.exp(-t * 2.2) * release
        elif voice in ('pulse', 'arp'):
            sound = np.zeros_like(t)
            # Band-limited odd harmonics avoid aliased digital square waves.
            for harmonic in range(1, min(15, int(SR / 2 / frequency)), 2):
                sound += np.sin(phase * harmonic) / harmonic
            sound *= .65
            envelope = np.minimum(t / .004, 1) * np.exp(-t * (3 if voice == 'pulse' else 6)) * release
        elif voice == 'bell':
            sound = np.sin(phase + 1.9 * np.sin(phase * 2) * np.exp(-t * 4))
            envelope = np.minimum(t / .007, 1) * np.exp(-t * 2.8) * release
        else:
            brightness = 2.6 if voice == 'clav' else 1.1
            sound = np.sin(phase + brightness * np.sin(phase * 2) * np.exp(-t * 7))
            sound += .08 * np.sin(phase * 3)
            envelope = np.minimum(t / .01, 1) * np.exp(-t * (5 if voice == 'clav' else 2.6)) * release
        result = (sound * envelope).astype(np.float32)
        tones[key] = result
        return result

    def percussion(voice):
        length = .36 if voice == 'kick' else .17
        t = np.arange(int(length * SR), dtype=np.float32) / SR
        if voice == 'kick':
            return np.sin(2 * np.pi * (44 * t + 6 * (1 - np.exp(-t * 32)))) * np.exp(-t * 14)
        noise = rng.normal(0, .35, len(t)).astype(np.float32)
        noise[1:] -= noise[:-1].copy() * .9
        if voice == 'snare':
            return (noise * .65 + np.sin(2 * np.pi * 175 * t) * .2) * np.exp(-t * 24)
        return noise * np.exp(-t * 75)

    drums = {voice: percussion(voice) for voice in ('kick', 'snare', 'hat')}
    major = kind in ('funk', 'chip') and seed % 4 != 0
    scale = [0, 2, 4, 5, 7, 9, 11, 12] if major else [0, 2, 3, 5, 7, 8, 10, 12]
    for bar in range(bars):
        # Intro / A / B / breakdown / return / outro; parts come and go.
        base = bar * 4 * beat
        intro = bar < 4
        outro = bar >= bars - 4
        breakdown = bars // 2 <= bar < bars // 2 + 4
        full = not (intro or outro or breakdown)
        phrase = (bar // 8) % 2
        root = roots[(bar // (2 if kind == 'ambient' else 1)) % len(roots)]
        intervals = [0, 4, 7, 11] if major else [0, 3, 7, 10]
        chord = [root + 12 + interval for interval in intervals]
        if phrase:
            chord[0] += 12  # A second voicing, not just a transposed repeat.
        for index, pitch in enumerate(chord):
            put(tone(pitch, 4 * beat + 1.2, 'pad'), base,
                .045 if kind == 'ambient' else .016, (index - 1.5) / 2)
        if kind in ('lofi', 'funk'):
            hits = [0, 1.5, 2.75] if kind == 'lofi' else [.25, 1, 1.75, 2.5, 3.25]
            for step in hits:
                for index, pitch in enumerate(chord):
                    put(tone(pitch, beat * 1.3, 'clav' if kind == 'funk' else 'keys'),
                        base + step * beat, .05 if full else .025, (index - 1.5) / 3)
        bass_steps = [0, 2] if kind == 'ambient' else [0, 1.5, 2.75] if kind == 'lofi' else [0, .75, 1.5, 2, 3.25, 3.75]
        for index, step in enumerate(bass_steps):
            pitch = root - 12 + (7 if index % 3 == 2 and kind != 'ambient' else 0)
            put(tone(pitch, beat * 1.2, 'bass'), base + step * beat, .2 if full else .1)
        if full:
            if kind != 'ambient':
                kicks = [0, 1.75, 2.5] if kind == 'lofi' else [0, 1.5, 2, 3.5] if kind == 'funk' else [0, 2]
                for step in kicks:
                    put(drums['kick'], base + step * beat, .3)
                for step in [1, 3]:
                    put(drums['snare'], base + step * beat, .28, -.12)
                for index, step in enumerate(np.arange(0, 4, .5)):
                    swing = .065 if kind == 'lofi' and index % 2 else 0
                    put(drums['hat'], base + (step + swing) * beat, .27 if index % 2 else .36, .4)
            elif bar % 4 == 0:
                put(drums['kick'], base, .075)
        if kind == 'chip' and not breakdown and not outro:
            for index in range(16):
                pitch = chord[(index + phrase) % 4]
                put(tone(pitch, beat * .24, 'arp'), base + index * beat / 4, .055, .3 if index % 2 else -.3)
        if not intro and not outro:
            steps = [.5, 2.5] if kind == 'ambient' else [.5, 1.25, 2.25, 3.5] if kind == 'lofi' else [0, .75, 1.5, 2.25, 3, 3.5]
            for index, step in enumerate(steps):
                degree = motif[(bar + index + phrase * 3) % len(motif)]
                pitch = root + 24 + scale[degree]
                sound = tone(pitch, beat * (2.6 if kind == 'ambient' else .9), 'pulse' if kind == 'chip' else 'bell')
                gain = .07 if kind == 'ambient' else .065
                put(sound, base + step * beat, gain, -.2)
                put(sound, base + (step + .75) * beat, gain * .3, .55)
    for delay, level in [(.139, .07), (.271, .05), (.413, .025)]:
        offset = int(delay * SR)
        mix[offset:] += mix[:-offset, ::-1].copy() * level
    fade = int(2.5 * SR)
    mix[:fade] *= np.linspace(0, 1, fade)[:, None]
    mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
    mix = np.tanh(mix * 1.2)
    mix *= .82 / max(float(np.max(np.abs(mix))), .01)
    with tempfile.TemporaryDirectory(prefix='.hifi-score-', dir=ROOT / 'tracks') as temporary:
        wav = Path(temporary) / 'song.wav'
        with wave.open(str(wav), 'wb') as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(SR)
            output.writeframes((mix * 32767).astype('<i2').tobytes())
        encoded = Path(temporary) / 'song.mp3'
        subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'error', '-i', str(wav),
                        '-codec:a', 'libmp3lame', '-b:a', '128k', str(encoded)], check=True)
        encoded.replace(destination)
    print(f'{destination.name}: {title}, {duration:.3f}s, {destination.stat().st_size} bytes', flush=True)
    return destination


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy', action='store_true', help='Render the original three long tracks instead')
    parser.add_argument('--overwrite', action='store_true', help='Explicitly replace existing generated audio')
    parser.add_argument('--station', choices=['dial-up', 'shareware-summer', 'night-build', 'pixel-drift'])
    args = parser.parse_args()
    if args.legacy:
        legacy = [
            ('dial-up-track-3.mp3', 82, [48, 53, 46, 51], 'lofi', 95),
            ('shareware-summer-track-2.mp3', 104, [48, 53, 55, 50], 'funk', 98),
            ('night-build-track-2.mp3', 72, [45, 41, 48, 43], 'ambient', 2000),
        ]
        for spec in legacy:
            if args.station and not spec[0].startswith(args.station + '-track-'):
                continue
            if (ROOT / 'tracks' / spec[0]).exists() and not args.overwrite:
                print(f'Keeping existing {spec[0]}')
                continue
            render(*spec)
    else:
        for score in SCORES:
            if not args.station or score[0] == args.station:
                render_score(score, args.overwrite)
