/**
 * What the local setup downloads. Everything is pinned by URL and SHA-256: the download is refused when the bytes
 * differ. Hashes come from the publishers: the GitHub release API's asset digests (llama.cpp) and the Hugging Face
 * file listing's LFS oids (models), read on 2026-11-09.
 */

export const LLAMA_TAG = 'b12211'

export interface RuntimeBuild {
  /** Folder name under <userData>/ai/runtime, and what the settings page can say. */
  id: string
  platform: NodeJS.Platform
  arch: string
  /** A GPU (Vulkan) build. The CPU build is the fallback when it will not start. */
  gpu: boolean
  url: string
  sha256: string
  size: number
}

const release = (file: string): string =>
  `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/${file}`

/** In order of preference for each platform. */
export const RUNTIME_BUILDS: readonly RuntimeBuild[] = [
  {
    id: `${LLAMA_TAG}-win-vulkan-x64`,
    platform: 'win32',
    arch: 'x64',
    gpu: true,
    url: release(`llama-${LLAMA_TAG}-bin-win-vulkan-x64.zip`),
    sha256: '20954cbad1a4626436c6ebaed5e48477f68427b075934689f360301ac426a2f1',
    size: 37845757
  },
  {
    id: `${LLAMA_TAG}-win-cpu-x64`,
    platform: 'win32',
    arch: 'x64',
    gpu: false,
    url: release(`llama-${LLAMA_TAG}-bin-win-cpu-x64.zip`),
    sha256: '23729000408c6968faf5e322afc99319d3b8c576ba872ef7663d9b89810090f3',
    size: 24886431
  },
  {
    // Apple silicon: Metal is part of this build, so it is the only one
    id: `${LLAMA_TAG}-macos-arm64`,
    platform: 'darwin',
    arch: 'arm64',
    gpu: true,
    url: release(`llama-${LLAMA_TAG}-bin-macos-arm64.tar.gz`),
    sha256: '4da4edb437358d31d55938ad849d262ca31b0e0ffb35e9caedb727a0cd5a8f0f',
    size: 16711245
  },
  {
    id: `${LLAMA_TAG}-ubuntu-vulkan-x64`,
    platform: 'linux',
    arch: 'x64',
    gpu: true,
    url: release(`llama-${LLAMA_TAG}-bin-ubuntu-vulkan-x64.tar.gz`),
    sha256: '9759acd293d3738f39d3ceed740bd3125d87dfb492ef8c4f00114d3393d37942',
    size: 35924677
  },
  {
    id: `${LLAMA_TAG}-ubuntu-x64`,
    platform: 'linux',
    arch: 'x64',
    gpu: false,
    url: release(`llama-${LLAMA_TAG}-bin-ubuntu-x64.tar.gz`),
    sha256: '962924b5431bc1237a9e5d26ba072d37b6fe05f79b495206e7ff6134887624c5',
    size: 23109987
  }
]

/** The builds for this system, best first (empty where llama.cpp has none we ship). */
export const runtimeBuildsFor = (platform: string, arch: string): RuntimeBuild[] =>
  RUNTIME_BUILDS.filter((b) => b.platform === platform && b.arch === arch)

export type ModelRole = 'embed' | 'chat'

export interface ModelSpec {
  role: ModelRole
  /** What the settings page calls it. */
  name: string
  /** File name under <userData>/ai/models. */
  file: string
  url: string
  sha256: string
  size: number
  purpose: string
}

/**
 * embed: EmbeddingGemma 300M, Q8_0. Multilingual (100+ languages), 768-dimensional, built for search and
 * clustering, and 334 MB, under the 350 MB budget. Q8 costs next to nothing in quality at this size.
 *
 * chat: Qwen3 1.7B, Q4_K_M, 1.1 GB. Good at short, well-formed JSON and at keeping the page's language; small
 * enough to answer a title in a second or two on a laptop CPU. (4B is better but 2.5 GB and several times slower,
 * which a background task does not need.) Thinking is switched off at launch, see serverArgs.
 */
export const MODELS: Record<ModelRole, ModelSpec> = {
  embed: {
    role: 'embed',
    name: 'EmbeddingGemma 300M',
    file: 'embeddinggemma-300M-Q8_0.gguf',
    url: 'https://huggingface.co/ggml-org/embeddinggemma-300M-GGUF/resolve/main/embeddinggemma-300M-Q8_0.gguf',
    sha256: 'b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63',
    size: 333590944,
    purpose: 'Finds pages by meaning, for suggested groups and history search'
  },
  chat: {
    role: 'chat',
    name: 'Qwen3 1.7B',
    file: 'Qwen3-1.7B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
    sha256: 'b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897',
    size: 1107409472,
    purpose: 'Writes short tab titles, file names and group names'
  }
}

/** How long "the GPU build did not start" holds before the GPU one is tried again (a driver can get fixed). */
export const CPU_ONLY_DAYS = 7

/**
 * Whether to keep to the CPU build, from what state.json says. A record with no time (written before records had
 * one) or an older one has run out: the GPU build gets another try.
 */
export function cpuOnlyHolds(state: unknown, now: number): boolean {
  const s = state as { cpuOnly?: unknown; at?: unknown } | null
  return (
    !!s &&
    s.cpuOnly === true &&
    typeof s.at === 'number' &&
    now - s.at >= 0 &&
    now - s.at < CPU_ONLY_DAYS * 86_400_000
  )
}
