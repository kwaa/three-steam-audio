# three-steam-audio

[Steam Audio](https://github.com/ValveSoftware/steam-audio) direct-path simulation and HRTF spatialization for Three.js and
React Three Fiber.

## Core API

```ts
import { createWorld, Materials } from 'three-steam-audio'

const audioContext = new AudioContext()
await audioContext.resume()

const world = await createWorld({ audioContext })
const source = world.createSource({
  directSimulation: {
    airAbsorption: true,
    occlusion: 'raycast',
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

## React Three Fiber

```tsx
import { Materials } from 'three-steam-audio'
import {
  AcousticMesh,
  SteamAudio,
  SteamAudioListener,
  SteamAudioSource,
} from 'three-steam-audio/react'

<React.Suspense fallback={null}>
  <SteamAudio audioContext={audioContext}>
    <SteamAudioListener />
    <AcousticMesh material={Materials.concrete}>
      <mesh geometry={roomGeometry} />
    </AcousticMesh>
    <SteamAudioSource input={input} position={[0, 1, -2]} />
  </SteamAudio>
</React.Suspense>
```

Create or resume the `AudioContext` from a user gesture to satisfy browser
autoplay policy.

## Development

```bash
just get_dependencies
just build-steam-audio
just build-bindings
pnpm build
pnpm test
```

The MVP implements direct simulation, HRTF, acoustic materials, static
geometry, and rigid dynamic geometry. Reflections, reverb, probes, pathing,
Ambisonics, and custom HRTFs are outside the MVP scope.

## Acknowledgements

three-steam-audio uses the Steam® Audio SDK. Steam® is a trademark or registered trademark of Valve Corporation in the United States of America and elsewhere. Steam® Audio, Copyright 2017 – present, Valve Corp. All rights reserved.
