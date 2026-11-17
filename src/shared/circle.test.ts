import { describe, expect, test } from 'bun:test'
import { boxOf, boxPolygon, inPolygon, isTap, multipartFile, scalePts } from './circle'

describe('lasso geometry', () => {
  test('box around points', () => {
    expect(
      boxOf([
        { x: 5, y: 9 },
        { x: 1, y: 20 },
        { x: 8, y: 2 }
      ])
    ).toEqual({ x: 1, y: 2, width: 7, height: 18 })
    expect(boxOf([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
  test('a tiny stroke is a tap', () => {
    expect(
      isTap([
        { x: 10, y: 10 },
        { x: 14, y: 12 }
      ])
    ).toBe(true)
    expect(
      isTap([
        { x: 10, y: 10 },
        { x: 60, y: 12 }
      ])
    ).toBe(false)
  })
  test('inside a polygon, including a concave one', () => {
    const square = boxPolygon({ x: 0, y: 0, width: 10, height: 10 })
    expect(inPolygon({ x: 5, y: 5 }, square)).toBe(true)
    expect(inPolygon({ x: 15, y: 5 }, square)).toBe(false)
    // a U shape: the gap in the middle is outside
    const u = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 7 },
      { x: 7, y: 7 },
      { x: 7, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ]
    expect(inPolygon({ x: 5, y: 3 }, u)).toBe(false)
    expect(inPolygon({ x: 1, y: 3 }, u)).toBe(true)
    expect(inPolygon({ x: 5, y: 9 }, u)).toBe(true)
  })
  test('screen points become page points at the page zoom', () => {
    expect(scalePts([{ x: 150, y: 300 }], 1 / 1.5)).toEqual([{ x: 100, y: 200 }])
  })
})

describe('upload body', () => {
  test('one file field, framed by the boundary', () => {
    const body = new TextDecoder().decode(
      multipartFile('encoded_image', 'a.jpg', 'image/jpeg', new Uint8Array([65, 66]), 'XYZ')
    )
    expect(body).toBe(
      '--XYZ\r\nContent-Disposition: form-data; name="encoded_image"; filename="a.jpg"\r\n' +
        'Content-Type: image/jpeg\r\n\r\nAB\r\n--XYZ--\r\n'
    )
  })
})
