interface ImageMap {
  setStyle (style: unknown): void
  isStyleLoaded (): boolean
  once (event: 'style.load', listener: () => void): void
  once (event: 'error', listener: (event: { error: Error }) => void): void
  jumpTo (options: { center: [number, number]; zoom: number }): void
  getSource (id: string): unknown
  removeLayer (id: string): void
  removeSource (id: string): void
  addSource (id: string, source: unknown): void
  addLayer (layer: unknown): void
}

declare global {
  var map: ImageMap
}

export {}
