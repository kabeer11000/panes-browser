import {
  YOUTUBE_CODECS,
  YOUTUBE_QUALITIES,
  YOUTUBE_SPEEDS,
  type YouTubeCodec,
  type YouTubeQuality
} from '../../../../shared/youtube'
import type { Settings } from '../../../../shared/types'
import { Group, Row, Select, Toggle } from '../ui'

const QUALITY_LABEL: Record<YouTubeQuality, string> = {
  auto: 'Automatic',
  max: 'Best available',
  hd2160: '2160p (4K)',
  hd1440: '1440p',
  hd1080: '1080p',
  hd720: '720p',
  large: '480p',
  medium: '360p'
}

const CODEC_LABEL: Record<YouTubeCodec, string> = {
  auto: 'Any',
  'no-av1': 'Avoid AV1',
  h264: 'H.264 only'
}

type ToggleKey =
  | 'youtubeHideShorts'
  | 'youtubeHideEndCards'
  | 'youtubeHideComments'
  | 'youtubeTheater'
  | 'youtubeAutoplay'

const TOGGLES: Array<{ key: ToggleKey; label: string; hint?: string }> = [
  { key: 'youtubeHideShorts', label: 'Hide Shorts', hint: 'Shelves, the menu entry and results.' },
  {
    key: 'youtubeHideEndCards',
    label: 'Hide end screen cards',
    hint: 'The cards and suggestions laid over the end of a video.'
  },
  { key: 'youtubeHideComments', label: 'Hide comments' },
  { key: 'youtubeTheater', label: 'Open videos in theater mode' },
  {
    key: 'youtubeAutoplay',
    label: 'Autoplay the next video',
    hint: "Off switches YouTube's own autoplay off."
  }
]

interface Props {
  s: Settings
  update: (patch: Partial<Settings>) => Promise<void>
}

/** Options for YouTube; its ads are handled by the ad blocker switch above. */
export function YouTubeSection({ s, update }: Props): React.JSX.Element {
  return (
    <Group
      title="YouTube"
      id="youtube"
      footer="Changes reach open YouTube tabs at once, apart from the video format and theater mode, which wait for a reload. Ads on YouTube are blocked whenever the ad blocker is on."
    >
      {TOGGLES.map((t) => (
        <Row key={t.key} label={t.label} hint={t.hint}>
          <Toggle label={t.label} on={s[t.key]} onChange={(v) => void update({ [t.key]: v })} />
        </Row>
      ))}
      <Row label="Playback speed" hint="Each video starts at this speed.">
        <Select
          label="Playback speed"
          value={s.youtubeSpeed}
          options={YOUTUBE_SPEEDS.map((v) => ({
            value: v as number,
            label: v === 1 ? 'Normal' : `${v}x`
          }))}
          onChange={(v) => void update({ youtubeSpeed: v })}
        />
      </Row>
      <Row label="Video quality" hint="Or the best below it when a video does not have it.">
        <Select
          label="Video quality"
          value={s.youtubeQuality}
          options={YOUTUBE_QUALITIES.map((v) => ({ value: v, label: QUALITY_LABEL[v] }))}
          onChange={(v) => void update({ youtubeQuality: v })}
        />
      </Row>
      <Row
        label="Video format"
        hint="H.264 uses the least power on most computers, but stops at 1080p."
      >
        <Select
          label="Video format"
          value={s.youtubeCodec}
          options={YOUTUBE_CODECS.map((v) => ({ value: v, label: CODEC_LABEL[v] }))}
          onChange={(v) => void update({ youtubeCodec: v })}
        />
      </Row>
    </Group>
  )
}
