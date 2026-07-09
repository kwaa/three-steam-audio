# three-steam-audio

[Steam Audio](https://github.com/ValveSoftware/steam-audio) for Three.js and React Three Fiber.

## Usage

```bash
pnpm add three-steam-audio
# yarn add three-steam-audio
# npm i three-steam-audio
```

### Three.js

```ts
import { createWorld, Materials } from 'three-steam-audio'

const audioContext = new AudioContext()
await audioContext.resume()

const world = await createWorld({ audioContext })
const source = world.createSource({
  direct: {
    airAbsorption: true,
    occlusion: { type: 'raycast' },
  },
  spatialization: {
    mode: 'binaural',
  },
})
const node = world.createNode(source)

input.connect(node)
node.connect(audioContext.destination)

world.scene.addStaticMesh({
  geometry: roomGeometry,
  material: Materials.concrete,
  matrixWorld: room.matrixWorld,
})
world.scene.commit()
```

Update listener and source world transforms before calling `world.step(delta)`.
The application owns the render loop and the `AudioContext`.

### Reflections and reverb

```ts
const world = await createWorld({
  audioContext,
  reflections: {
    maxDuration: 2,
    maxOrder: 1,
    maxRays: 4096,
  },
})

const reflections = world.createReflectionBus({ wet: 1 })
const reverb = world.createReverbBus({ wet: 0.5 })
reflections.connect(audioContext.destination)
reverb.connect(audioContext.destination)

const source = world.createSource({
  reflections: { mixLevel: 0.7 },
})
const node = world.createNode(source)
node.connectReflections(reflections, { gain: 1 })
node.connectReverb(reverb, { gain: 0.4 })

world.listener.setReverb({ reverbScale: [1, 1, 1] })
```

Reflection ray tracing runs in a dedicated worker when `Worker` is available.
The current browser renderer uses Steam Audio's parametric reflection effect.
Convolution and hybrid reflection effects are not supported because their
opaque IR handles cannot cross independent WASM runtimes.

### React Three Fiber

```tsx
import { Materials } from 'three-steam-audio'
import {
  AcousticMesh,
  SteamAudio,
  SteamAudioEnvironment,
  SteamAudioListener,
  SteamAudioSource,
} from 'three-steam-audio/react'

<React.Suspense fallback={null}>
  <SteamAudio
    audioContext={audioContext}
    options={{ reflections: { maxRays: 4096 } }}
  >
    <SteamAudioListener />
    <SteamAudioEnvironment
      reflections={{ wet: 1 }}
      reverb={{ wet: 0.5 }}
    >
      <AcousticMesh material={Materials.concrete}>
        <mesh geometry={roomGeometry} />
      </AcousticMesh>
      <SteamAudioSource
        input={input}
        position={[0, 1, -2]}
        reflections={{ mixLevel: 0.7 }}
        reflectionsSend={1}
        reverbSend={0.4}
      />
    </SteamAudioEnvironment>
  </SteamAudio>
</React.Suspense>
```

Create or resume the `AudioContext` from a user gesture to satisfy browser
autoplay policy.

`SteamAudioNode` initialization is asynchronous. Use `await node.ready` when
playback must not begin until its AudioWorklet DSP runtime is ready. If
initialization fails, `ready` rejects and `node.state` becomes `"failed"`;
the node outputs silence instead of bypassing the unprocessed input.

## Development

```bash
just get_dependencies
just build-steam-audio
just build-bindings
pnpm build
pnpm test
pnpm dev:example-react # run demo
```

## Roadmap

- [x] WebAssembly-based Steam Audio runtime loading.
- [x] AudioWorklet-based direct-effect and binaural rendering pipeline.
- [x] Direct-path simulation for distance attenuation, air absorption,
      directivity, occlusion, and transmission.
- [x] Built-in HRTF spatialization for point sources.
- [x] Acoustic material support.
- [x] Static acoustic mesh support.
- [x] Rigid dynamic acoustic mesh support.
- [x] Core Three.js world/source/listener API.
- [x] React Three Fiber integration components.
- [ ] Add support for custom HRTFs via SOFA files.
- [ ] Improve direct-path usability with better validation, diagnostics, and
      browser/runtime error handling.
- [x] Add worker-based real-time parametric reflections simulation.
- [x] Add per-source reflection rendering and listener reverb buses.
- [ ] Add convolution or hybrid reflections through a web-safe IR transport.
- [ ] Add pathing for moving sources and listeners without introducing baking
      workflows.
- [ ] Add Ambisonics support.
- [ ] Investigate web-appropriate acceleration paths after the runtime feature
      set is stable.

Non-goals:

- Probe generation and probe-batch workflows.
- Baked reflections, baked reverb, or baked pathing.
- Editor-style authoring flows modeled after the official Unity integration.

## Acknowledgements

three-steam-audio uses the Steam® Audio SDK. Steam® is a trademark or registered trademark of Valve Corporation in the United States of America and elsewhere. Steam® Audio, Copyright 2017 – present, Valve Corp. All rights reserved.

## License

[Apache-2.0](./LICENSE)
