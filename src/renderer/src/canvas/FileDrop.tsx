import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { SharePerson } from '@shared/types'
import { Face, SendingList } from '@renderer/components/ShareSection'
import { useShareState } from '@renderer/components/useShare'
import { postFile, sendFile, useSending } from '@renderer/fileSend'

const NOBODY: SharePerson[] = []

/** Files are being dragged over the window (from another app): counted in and out, as the drag crosses elements. */
function useDraggingFiles(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let depth = 0
    const files = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent): void => {
      if (!files(e)) return
      depth++
      setOn(true)
    }
    const leave = (e: DragEvent): void => {
      if (!files(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setOn(false)
    }
    const end = (): void => {
      depth = 0
      setOn(false)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    // capture: a target that takes the drop stops it before it would bubble up here
    window.addEventListener('drop', end, true)
    window.addEventListener('dragend', end, true)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', end, true)
      window.removeEventListener('dragend', end, true)
    }
  }, [])
  return on
}

/** One place to drop on: a person (sent to them alone) or everyone (offered in the chat). */
function Target({
  label,
  sub,
  onFiles,
  children
}: {
  label: string
  sub: string
  onFiles: (files: FileList) => void
  children: React.ReactNode
}): React.JSX.Element {
  const [over, setOver] = useState(false)
  return (
    <div
      className={'cv-drop-t' + (over ? ' over' : '')}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        // theirs, not the board's (which would make a card of it)
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files)
      }}
    >
      {children}
      <b>{label}</b>
      <small>{sub}</small>
    </div>
  )
}

/**
 * Sharing files on a shared board, Snapdrop's way: drag files over the board and the people here rise from its
 * bottom edge; drop on someone to send it to them alone, on Everyone to offer it in the chat. Anywhere else on the
 * board it becomes a card, as before. Straight between the computers (renderer/fileSend.ts): never stored online.
 * Files on their way from here show in a tray in the corner.
 */
export function FileDrop({
  spaceId,
  shared,
  onChat
}: {
  spaceId: number
  shared: boolean
  /** Open the chat (a file was offered there). */
  onChat: () => void
}): React.JSX.Element | null {
  const people = (useShareState(spaceId, shared)?.people ?? NOBODY).filter((p) => p.files && p.rtc)
  const dragging = useDraggingFiles()
  const sending = useSending(spaceId)
  const reduced = useReducedMotion()
  if (!shared) return null
  return (
    <>
      <AnimatePresence>
        {dragging && people.length > 0 && (
          <motion.div
            className="cv-drop"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            <p className="cv-drop-head">
              Drop on someone to send it to them, or on the board to add it there
            </p>
            <div className="cv-drop-row">
              {people.slice(0, 8).map((p) => (
                <Target
                  key={p.id}
                  label={p.name.split(' ')[0]}
                  sub="Just them"
                  onFiles={(files) => {
                    for (const f of files) sendFile(spaceId, p.rtc, p.name, f)
                  }}
                >
                  <Face name={p.name} color={p.color} size={48} />
                </Target>
              ))}
              {people.length > 1 && (
                <Target
                  label="Everyone"
                  sub="In the chat"
                  onFiles={(files) => {
                    for (const f of files) postFile(spaceId, f)
                    onChat()
                  }}
                >
                  <span className="cv-drop-all" aria-hidden="true">
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
                    </svg>
                  </span>
                </Target>
              )}
            </div>
            <p className="cv-drop-foot">Sent straight from your computer, never stored online</p>
          </motion.div>
        )}
      </AnimatePresence>
      {sending.length > 0 && (
        <div className="cv-sending" aria-label="Files you are sending">
          <SendingList spaceId={spaceId} />
        </div>
      )}
    </>
  )
}
