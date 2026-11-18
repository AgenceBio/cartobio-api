import { vi } from 'vitest'

class HTTPError extends Error {
  constructor() {
    super('HTTPError')
  }
}

class TimeoutError extends Error {
  constructor() {
    super('TimeoutError')
  }
}

const __mocks = {
  get: vi.fn().mockName('extend.get'),
  post: vi.fn().mockName('extend.post')
}

const got = Object.assign(vi.fn(), {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  stream: vi.fn(),
  __mocks,
  HTTPError,
  TimeoutError,
  extend: vi.fn(() => {
    return {
      __mocks,
      ...__mocks
    }
  })
})

Object.assign(got, { default: got })

export default got
export const { get, post, put, patch, stream, extend } = got
export { HTTPError, TimeoutError }
