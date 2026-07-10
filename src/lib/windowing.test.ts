import { describe, expect, it } from 'vitest'
import { computeWindow } from './windowing'

describe('computeWindow', () => {
  it('맨 위에서는 0부터 뷰포트 분량과 overscan만큼 렌더한다', () => {
    const range = computeWindow(0, 600, 80, 1000, 5)
    expect(range).toEqual({ start: 0, end: 13, totalHeight: 80000 })
  })

  it('중간 스크롤에서는 위아래 overscan을 포함한 범위를 반환한다', () => {
    const range = computeWindow(4000, 600, 80, 1000, 5)
    expect(range.start).toBe(45)
    expect(range.end).toBe(63)
  })

  it('끝 근처에서는 end가 count로 클램프된다', () => {
    const range = computeWindow(79000, 600, 80, 1000, 5)
    expect(range.end).toBe(1000)
  })

  it('count가 0이면 빈 범위를 반환한다', () => {
    expect(computeWindow(0, 600, 80, 0, 5)).toEqual({ start: 0, end: 0, totalHeight: 0 })
  })

  it('목록이 뷰포트보다 짧으면 전체를 렌더한다', () => {
    const range = computeWindow(0, 600, 80, 3, 5)
    expect(range).toEqual({ start: 0, end: 3, totalHeight: 240 })
  })

  it('범위 밖의 forcedIndex는 범위를 확장해 포함한다', () => {
    const range = computeWindow(0, 600, 80, 1000, 5, 500)
    expect(range.start).toBeLessThanOrEqual(500)
    expect(range.end).toBeGreaterThan(500)
  })

  it('count를 벗어난 forcedIndex는 무시한다', () => {
    const range = computeWindow(0, 600, 80, 10, 5, 999)
    expect(range.end).toBe(10)
  })
})
