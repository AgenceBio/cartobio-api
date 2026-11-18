import gotModule, * as gotExports from 'got'
import type { Mock } from 'vitest'

export const got = gotModule as unknown as {
  get: Mock
  post: Mock
  stream: Mock
  extend: Mock
  __mocks: { get: Mock; post: Mock }
}

type MockedErrorClass = new (...args: unknown[]) => Error & { response?: unknown }
export const HTTPError = gotExports.HTTPError as unknown as MockedErrorClass
export const TimeoutError = gotExports.TimeoutError as unknown as MockedErrorClass

export const { get, post } = got
