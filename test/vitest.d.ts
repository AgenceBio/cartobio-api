import 'vitest'

interface CartoBioMatchers<R = unknown> {
  stringMatchingISODate: () => R
  toBeAFeatureId: () => R
}

declare module 'vitest' {
  interface Matchers<T = any> extends CartoBioMatchers<T> {}
  interface AsymmetricMatchersContaining extends CartoBioMatchers {}
}
