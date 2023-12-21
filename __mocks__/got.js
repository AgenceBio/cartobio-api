const got = jest.createMockFromModule('got')

const __mocks = {
  get: jest.fn().mockName('extend.get'),
  post: jest.fn().mockName('extend.post')
}

got.__mocks = __mocks
got.extend = jest.fn(() => {
  return {
    __mocks,
    ...__mocks
  }
})

module.exports = got
