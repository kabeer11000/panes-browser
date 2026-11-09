import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

/** One sheet: sized from the page's own proportions, drawn only while it is near the viewport. */
function Sheet({
  doc,
  num,
  width,
  height,
  root
}: {
  doc: PDFDocumentProxy
  num: number
  width: number
  height: number
  root: HTMLElement | null
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(num <= 2)

  useEffect(() => {
    const el = box.current
    if (!el || !root) return
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), {
      root,
      rootMargin: '900px 0px'
    })
    io.observe(el)
    return () => io.disconnect()
  }, [root])

  useEffect(() => {
    if (!near || !canvas.current) return
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null
    let dead = false
    void doc.getPage(num).then(
      (page) => {
        if (dead || !canvas.current) return
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (width / base.width) * devicePixelRatio })
        const c = canvas.current
        c.width = Math.floor(viewport.width)
        c.height = Math.floor(viewport.height)
        task = page.render({ canvas: c, viewport })
        task.promise.catch(() => undefined) // a cancelled render rejects
      },
      () => undefined
    ) // the document was replaced while this was asked
    return () => {
      dead = true
      task?.cancel()
    }
  }, [doc, num, near, width])

  return (
    <div className="pr-sheet" ref={box} style={{ width, height }} data-page={num}>
      <canvas ref={canvas} />
    </div>
  )
}

/** The pages in a column, all at one size. Reports the page nearest the top as the reader scrolls. */
export function Pages({
  doc,
  sizes,
  scale,
  dim,
  onPage,
  scroller
}: {
  doc: PDFDocumentProxy
  /** Each page's width and height at scale 1 (points). */
  sizes: Array<[number, number]>
  /** CSS pixels per point. */
  scale: number
  dim: boolean
  onPage: (n: number) => void
  scroller: HTMLElement | null
}): React.JSX.Element {
  useEffect(() => {
    if (!scroller) return
    let raf = 0
    const sync = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const line = scroller.scrollTop + scroller.clientHeight / 3
        let n = 1
        scroller.querySelectorAll<HTMLElement>('.pr-sheet').forEach((el) => {
          if (el.offsetTop <= line) n = Number(el.dataset.page)
        })
        onPage(n)
      })
    }
    sync()
    scroller.addEventListener('scroll', sync, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      scroller.removeEventListener('scroll', sync)
    }
  }, [scroller, onPage, sizes, scale])

  return (
    <div className={'pr-sheets' + (dim ? ' dim' : '')}>
      {sizes.map(([w, h], i) => (
        <Sheet
          key={i}
          doc={doc}
          num={i + 1}
          width={Math.round(w * scale)}
          height={Math.round(h * scale)}
          root={scroller}
        />
      ))}
    </div>
  )
}
