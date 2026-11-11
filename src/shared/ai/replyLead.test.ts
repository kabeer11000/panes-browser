import { describe, expect, test } from 'bun:test'
import { cleanLead } from './replyLead'

describe('cleanLead', () => {
  test('drops a sentence narrating the request at the start', () => {
    expect(cleanLead('The user is asking me to list their tabs. You have three tabs open: Gmail, MDN and YouTube.')).toEqual({
      text: 'You have three tabs open: Gmail, MDN and YouTube.',
      open: false
    })
    expect(cleanLead('Okay, the user wants a summary of this page. It argues that...').text).toBe(
      'It argues that...'
    )
    expect(cleanLead('User asked about pricing. The plan costs $10.').text).toBe('The plan costs $10.')
  })
  test('drops a reasoning block, and waits while one is still being written', () => {
    expect(cleanLead('<think>they want tabs</think>\nYou have two tabs.').text).toBe('You have two tabs.')
    expect(cleanLead('<think>they want').open).toBe(true)
  })
  test('waits while the start could still become such a sentence', () => {
    expect(cleanLead('The us').open).toBe(true)
    expect(cleanLead('The user is asking me').open).toBe(true)
    expect(cleanLead('').open).toBe(true)
  })
  test('leaves real answers alone, including ones that mention users', () => {
    expect(cleanLead('You have three tabs open.')).toEqual({ text: 'You have three tabs open.', open: false })
    expect(cleanLead('Users of this site can export data. It is free.').text).toBe(
      'Users of this site can export data. It is free.'
    )
    expect(cleanLead('The page says the user manual is outdated.').open).toBe(false)
    expect(cleanLead('The page says the user manual is outdated.').text).toBe(
      'The page says the user manual is outdated.'
    )
    expect(cleanLead('Thanks! Here it is.').open).toBe(false)
  })
})
