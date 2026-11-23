/** The invite link: the room in the address, its secret after # (never sent to the server). */
export const GET_PANES = 'https://panes.kabeers.network/'
export const room = (/^\/s\/([A-Za-z0-9_-]{16,64})\/?$/.exec(location.pathname) ?? [])[1]
export const secret = location.hash.slice(1)
export const valid = !!room && /^[A-Za-z0-9_-]{43}$/.test(secret)
