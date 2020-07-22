'use strict'

const { post } = require('got')
const FormData = require('form-data')

async function createCard ({ key, token, idList, uploads, name, desc }) {
  const card = await post('https://api.trello.com/1/cards', {
    json: { key, token, idList, name, desc }
  }).json()

  const { id: cardId } = card
  return Promise.all(uploads.map(({ content, type, filename }) => {
    const form = new FormData()
    form.append('id', cardId)
    form.append('key', key)
    form.append('token', token)
    form.append('name', filename)
    form.append('mimeType', type)
    form.append('file', Buffer.from(content, 'base64'), {
      filename
    })

    return post(`https://api.trello.com/1/cards/${cardId}/attachments`, {
        body: form,
        headers: form.getHeaders()
     })
  }))
}

module.exports = { createCard }
