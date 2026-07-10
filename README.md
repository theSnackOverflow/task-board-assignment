# Task Board — 과제 제출 (강지훈)

- 배포 URL: https://thesnackoverflow.github.io/task-board-assignment/
- 저장소: https://github.com/theSnackOverflow/task-board-assignment
- 원본 과제: https://github.com/kimxmfldh/task-board-assignment

## 실행 방법

```bash
npm install    # postinstall에서 MSW 워커 생성
npm run dev    # 개발 서버
npm test       # 유닛 + 컴포넌트 테스트 (66개)
npm run build  # 타입체크 + 프로덕션 빌드
```

## 구현 범위

### Priority 1 (전부 구현)

| 요구사항 | 구현 요약 |
| ---- | ---- |
| 로드 상태 처리 | 스켈레톤 / 에러 + 재시도 버튼 / 빈 상태. 전체 빈 상태와 검색 결과 빈 상태를 구분 |
| 낙관적 업데이트와 롤백 | 서버 확정 상태(serverCache)와 대기 큐(pendingQueue)를 분리, 화면은 둘의 파생 계산. 실패 = 큐에서 제거 = 자동 롤백 + sticky 토스트(다시 시도) |
| 경쟁 상태 처리 | 태스크별 요청 직렬화(in-flight 1개) + 전송 직전 version 주입 + 연속 이동 병합(coalescing) |
| 5,000개 성능 | 컬럼별 가상 스크롤 직접 구현(computeWindow 순수 함수). 카드 DOM 5,000개에서 39개로 축소 |
| 태스크 관리(CRUD) | 생성(제목/우선순위 필수, 설명 선택), 수정, 삭제(확인 다이얼로그). 전부 낙관 반영 |
| 핵심 로직 유닛 테스트 | 뮤테이션 코어, 병합 규칙, 롤백, 가상 스크롤 계산, 필터 등 66개 테스트 |

### Priority 2 (전부 구현)

| 항목 | 구현 요약 |
| ---- | ---- |
| 409 충돌 처리 UX | 서버 최신 상태 즉시 반영 + "내 변경 다시 적용" 액션. 같은 태스크 3회 반복 시 재적용 중단 안내 |
| 재시도 / 백오프 | 자동 2회(300ms, 900ms + jitter) 후 수동 전환. 네트워크 단절(TypeError)은 재시도 예산 미소모 |
| 다중 탭 동기화 | BroadcastChannel로 성공 결과 전파, 수신 측은 version 비교로 높은 쪽만 반영 |
| 키보드 접근성 | 카드 포커스 후 좌우 화살표로 컬럼 이동, Enter 수정, Delete 삭제. 숨김 라이브 영역으로 결과 안내 |
| 검색 디바운싱, 다중 필터 | 180ms 디바운스 + useDeferredValue, 우선순위 다중 필터 토글 |

### 미구현과 알려진 한계

- 태그, 담당자 필터: 우선순위 필터와 같은 패턴의 반복이라 우선순위 필터로 패턴을 증명하는 것까지만 구현했습니다.
- 컬럼 내 위치 지정 드롭: 스타터와 동일하게 드롭은 컬럼 단위입니다. 서버 API에 순서 필드가 없어 위치를 저장할 수 없기 때문에 추가하지 않았습니다.
- 키보드 이동 직후 대상 카드가 가상 스크롤 범위 밖이면 포커스 복원이 실패할 수 있습니다.
- 필터를 바꿔도 컬럼 스크롤 위치는 유지되지 않습니다(브라우저 클램프에 위임).

## 아키텍처 개요

```
사용자 조작 (드롭 / 폼 / 삭제 / 키보드)
  → 큐에 추가 (병합 규칙 적용) → 화면 즉시 반영 (파생 뷰)
  → 엔진이 태스크별로 직렬 전송 (전송 직전 version 주입)
      성공: serverCache 갱신 + 다른 탭에 전파
      실패: 재시도 → 소진 시 큐 제거(= 자동 롤백) + 토스트
```

- `src/lib/` — 순수 함수(뮤테이션 적용, 병합, 가상 스크롤 계산, 필터). 전부 유닛 테스트 대상
- `src/store/` — 상태 보관(taskStore)과 비동기 엔진(engine), 탭 동기화(sync). React 밖
- `src/hooks/`, `src/components/` — React 계층. store만 알고 API 클라이언트를 직접 호출하지 않음

자세한 결정 근거와 트레이드오프는 [DECISIONS.md](./DECISIONS.md), AI 활용 내역은 [AI_USAGE.md](./AI_USAGE.md)에 있습니다.

## 기술 스택

스타터 그대로 (React 18, TypeScript strict, Vite, Vitest, MSW). 상태 관리, 드래그, UI 라이브러리를 추가하지 않았습니다. 이유는 DECISIONS.md 1절과 4절에 있습니다.

## 검증 방법 (평가자용)

- 롤백: `src/mocks/config.ts`의 `WRITE_FAILURE_RATE`를 1로 올리면 모든 조작이 즉시 반영된 뒤 정확히 되돌아오며 토스트가 표시됩니다
- 연속 이동: 카드 하나를 빠르게 여러 컬럼으로 이동한 뒤 새로고침해도 마지막 위치가 유지됩니다
- 오프라인: DevTools Network를 Offline으로 바꾸면 배너가 뜨고 쓰기가 차단되며, Online 복귀 시 대기 중이던 변경이 자동 저장됩니다
- 409: 탭 2개에서 같은 카드를 서로 다르게 수정하면 늦은 쪽에 충돌 안내와 "내 변경 다시 적용" 버튼이 표시됩니다
- 다중 탭: 탭 2개를 열고 한쪽에서 이동하면 다른 탭에 반영됩니다
