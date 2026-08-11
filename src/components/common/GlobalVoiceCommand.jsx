// src/components/common/GlobalVoiceCommand.jsx
// 앱 전체(홈 포함)에서 항상 떠 있는 마이크 버튼. 기본값은 꺼짐 — 트레이너가 직접 켜야 한다.
// 켜져 있을 때는 화면에 항상 빨간 점으로 표시해 프라이버시를 알린다.
//
// [2026-08-08] 마이크 켜는 즉시 "듣고 있어요"를 알려주던 진단용 확인 문구는
// 뺐다 — TTS·화면 표시가 정상 동작함을 실기기 캡처로 이미 확인했고(웨이크워드
// "모미야"가 "몸이야"로 오인식되던 게 진짜 원인이었음, useMomiVoice.js 참고),
// 요청하신 흐름("모미야"→"네, 선생님"→...)엔 그 앞에 아무 발화가 없어야 해서다.
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMomiVoice } from '../../hooks/useMomiVoice';
import { useMomiSpeech } from '../../hooks/useMomiSpeech';
import { processVoiceCommand, buildTimerControlMessage } from '../../services/voiceCommandService';
import {
  buildReservationSummary,
  buildCancelSummary,
  buildRescheduleSummary,
  interpretConfirmationReply,
  confirmReservation,
  cancelReservation,
  rescheduleReservation,
} from '../../services/reservationService';
// [momi 쓰기 권한 확장 2026-08-10] 예약류와 완전히 같은 확인 흐름(요약 말하기→
// awaitReply→확인 후 저장)을 타는 새 쓰기 기능 3종. runVoiceConfirmFlow를
// 그대로 재사용한다(아래).
import {
  buildAddMemoSummary,
  confirmAddMemberMemo,
  buildAdjustSessionSummary,
  confirmAdjustSessionCount,
  buildUpdateInfoSummary,
  confirmUpdateMemberInfo,
} from '../../services/memberWriteService';
import { useAuth } from '../../contexts/AuthContext';
import { store } from '../../demoData';
import { scopeMembersToTrainer, sortByName } from '../../utils/memberList';
import { getActiveHistory, recordChatTurn, clearHistory } from '../../voice/chatHistory';

export default function GlobalVoiceCommand() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role === 'admin' ? 'admin' : 'trainer';
  const allMembers = useMemo(
    () => sortByName(scopeMembersToTrainer(store.getMembers(), user)),
    [user]
  );
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  const { speak, stop: stopSpeaking, unlock: unlockSpeech } = useMomiSpeech();

  // [예약 생성 프로젝트 2단계 2026-08-08] KioskVoiceCommand.jsx와 동일한 이유로
  // ref를 다리로 씀 — awaitReply는 useMomiVoice()가 반환하는데 useMomiVoice()는
  // handleCommand를 onCommand로 받는 쪽이라 같은 렌더 안에서 직접 참조하면 순환
  // 의존이 된다. awaitReply 자체는 deps:[]인 안정적 함수라 ref에 담아두면 항상
  // 최신 값을 가리킨다.
  const awaitReplyRef = useRef(null);
  // [마이크 자동 꺼짐 2026-08-11] 폰/태블릿모드는 "명령 하나 처리하면 자동으로
  // 꺼지는" 방식으로 바뀐다 — stopListening은 useMomiVoice()가 반환하는데
  // useMomiVoice()는 handleCommand를 onCommand로 받는 쪽이라(아래) 같은 렌더
  // 안에서 handleCommand가 직접 참조하면 순환 의존이 된다. awaitReplyRef와
  // 완전히 같은 이유로 ref를 다리로 쓴다.
  const stopListeningRef = useRef(null);
  // 예약 확인 흐름이 응답을 기다리는 중에 트레이너가 마이크 버튼을 눌러 끄면,
  // useMomiVoice 내부 cancelAwaitReply()가 awaitReply 콜백을 조용히 버려버려서
  // (다시 호출 안 됨) 아래 runReservationConfirmFlow의 Promise가 영원히 안
  // 끝나고, 그 결과 handleCommand의 finally도 못 돌아 busy=true가 안 풀려
  // 마이크 버튼이 먹통이 된다. 진행 중인 확인 흐름의 resolve를 여기 담아뒀다가
  // toggle()에서 마이크를 끌 때 직접 풀어준다.
  const pendingConfirmResolveRef = useRef(null);

  // [버그 수정 — 명령 겹침 2026-08-09] KioskVoiceCommand.jsx와 같은 이유 —
  // useMomiVoice.js의 onresult는 onCommand를 await 없이 fire-and-forget으로
  // 부른다. 이전 "모미야, [명령]"이 아직 처리 중(특히 네트워크 응답을 기다리는
  // 동안, awaitReply를 걸기 전)일 때 새 "모미야, [명령]"이 겹쳐 들어오면
  // handleCommand가 두 번 동시에 돌면서 awaitReply 슬롯(훅 안에 하나뿐)을
  // 두 번째 호출이 덮어써, 첫 번째 명령의 확인 흐름이 응답을 영영 못 받고
  // 멈춰버릴 수 있다. 한 번에 한 명령만 처리하도록 막는다.
  const isHandlingRef = useRef(false);

  // [음성 대화형 2026-08-09] KioskVoiceCommand.jsx와 동일 — 실제 관리 로직은
  // voice/chatHistory.js에 있다.
  const chatHistoryRef = useRef([]);
  const lastChatAtRef = useRef(null);

  // [예약 생성 프로젝트 3단계 2026-08-09] "예약 만들기 확인"과 "예약 취소 확인"의
  // 뼈대(요약 말하기 → awaitReply → 확인/취소/불명확 분기, busy 해제, 중도 취소
  // 대비 pendingConfirmResolveRef)가 완전히 같아서 공통 함수로 뽑는다 — 실제로
  // 할 일(onConfirm)과 문구만 다르다.
  const runVoiceConfirmFlow = useCallback(
    ({ summary, onConfirm, onCancelMessage }) => {
      return new Promise((resolveOuter) => {
        // resolve를 감싸서, 실제로 끝날 때 ref도 같이 비운다(중복 resolve 방지 +
        // toggle()이 "지금 진행 중인 흐름이 있는지"를 정확히 판단할 수 있게).
        const resolve = (...args) => {
          pendingConfirmResolveRef.current = null;
          resolveOuter(...args);
        };
        pendingConfirmResolveRef.current = resolve;

        const awaitReply = awaitReplyRef.current;
        if (!awaitReply) {
          const msg = '지금은 확인을 받을 수 없어요. 다시 말씀해주세요.';
          setFeedback(msg);
          speak(msg);
          setTimeout(() => setFeedback(''), 5000);
          resolve();
          return;
        }

        setFeedback(summary);
        speak(summary);
        // [버그 방지] busy는 버튼의 disabled를 제어한다 — "네/아니요" 대답을
        // 기다리는 이 여러 초짜리 구간까지 계속 true로 두면 마이크 버튼
        // 자체가 눌리지 않아서, 바로 위 pendingConfirmResolveRef를 통한
        // 중도 취소 경로가 영원히 실행될 수 없는 죽은 코드가 돼버린다.
        // 여기서 미리 풀어줘야 트레이너가 대답 대신 버튼으로 끌 수 있다
        // (음성인식 자체는 awaitReply가 여전히 이 발화 하나만 가로채므로
        // 다른 명령으로 새지 않음).
        setBusy(false);

        awaitReply((heard) => {
          const decision = interpretConfirmationReply(heard);
          if (decision === 'confirm') {
            Promise.resolve()
              .then(onConfirm)
              .then((okMessage) => {
                setFeedback(okMessage);
                speak(okMessage);
                setTimeout(() => setFeedback(''), 5000);
              })
              .catch((e) => {
                const fail = '죄송해요, 처리 중 오류가 났어요.';
                setFeedback(`${fail}\n[진단] ${e?.message || e}`);
                speak(fail);
                setTimeout(() => setFeedback(''), 8000);
              })
              .finally(resolve);
          } else if (decision === 'cancel') {
            setFeedback(onCancelMessage);
            speak(onCancelMessage);
            setTimeout(() => setFeedback(''), 4000);
            resolve();
          } else {
            // unclear·timeout — 판단 근거가 없을 땐 진행하지 않는 쪽이 안전하다
            // (데이터를 쓰거나 지우는 작업은 애매하면 항상 사람에게 다시 확인받는다).
            const msg = '못 알아들어서 진행하지 않았어요. 다시 말씀해주세요.';
            setFeedback(msg);
            speak(msg);
            setTimeout(() => setFeedback(''), 5000);
            resolve();
          }
        }, 12000);
      });
    },
    [speak]
  );

  // 안내만 하고 확인 없이 바로 끝내는 경우(대상 특정 실패 등) 공통 처리.
  // busy는 handleCommand의 finally가 정리하므로 여기서 건드릴 필요 없다(빠르게
  // resolve되므로 disabled 상태로 오래 묶여있지 않음).
  const announceAndFinish = useCallback(
    (message, timeoutMs = 6000) => {
      setFeedback(message);
      speak(message);
      setTimeout(() => setFeedback(''), timeoutMs);
      return Promise.resolve();
    },
    [speak]
  );

  // [예약 생성 프로젝트 2단계 2026-08-08] propose_reservation 결과(아직 저장 안 됨)를
  // 받으면 요약을 말해주고 확인을 기다린 뒤에만 실제로 저장한다.
  const runReservationConfirmFlow = useCallback(
    (propose) => {
      const { draft, warnings } = propose;
      // date/startTime/trainerId 중 하나라도 없으면 draft 자체가 저장 불가능한
      // 상태라, 확인을 받는 것 자체가 의미 없다 — 바로 안내하고 끝낸다.
      const hasBlockingIssue = !draft?.date || !draft?.startTime || !draft?.trainerId;
      if (hasBlockingIssue) {
        return announceAndFinish(
          warnings?.[0] || '예약 정보가 부족해서 진행할 수 없어요. 회원·트레이너·일시를 다시 말씀해주세요.'
        );
      }
      return runVoiceConfirmFlow({
        summary: buildReservationSummary(propose),
        onConfirm: () =>
          confirmReservation(draft).then(
            () => `${draft.memberName ? draft.memberName + '님 ' : ''}${draft.date} ${draft.startTime} 예약을 등록했어요.`
          ),
        onCancelMessage: '알겠습니다, 예약은 만들지 않을게요.',
      });
    },
    [runVoiceConfirmFlow, announceAndFinish]
  );

  // [예약 생성 프로젝트 3단계 2026-08-09] propose_cancel_reservation 결과(아직
  // 안 지워짐)를 받으면 대상을 요약해 확인받고, 확인 후에만 실제로 취소한다.
  // 대상을 하나로 특정 못 했으면(여러 건/없음) 확인 자체를 안 받고 바로 안내한다
  // — 되돌릴 수 없는 삭제라 애매하면 절대 진행하지 않는다.
  const runCancelConfirmFlow = useCallback(
    (propose) => {
      const { schedule, warnings } = propose;
      if (!propose.ready || !schedule) {
        return announceAndFinish(warnings?.[0] || '취소할 예약을 찾지 못했어요.');
      }
      return runVoiceConfirmFlow({
        summary: buildCancelSummary(propose),
        onConfirm: () =>
          cancelReservation(schedule.id).then(
            () => `${schedule.memberName ? schedule.memberName + '님 ' : ''}${schedule.date} ${schedule.startTime} 예약을 취소했어요.`
          ),
        onCancelMessage: '알겠습니다, 예약은 그대로 둘게요.',
      });
    },
    [runVoiceConfirmFlow, announceAndFinish]
  );

  // [예약 생성 프로젝트 4단계 2026-08-09] propose_reschedule_reservation 결과
  // (아직 안 바뀜)를 받으면 "OO 일시 → 새 일시"를 요약해 확인받고, 확인 후에만
  // 실제로 옮긴다. 옮길 대상 자체를 특정 못 했으면(여러 건/없음) 확인 없이 바로
  // 안내한다. 새 시간대 충돌 경고는(있다면) 소프트 경고라 여기서 막지 않고
  // buildRescheduleSummary가 문구에 이어 붙여 트레이너가 듣고 최종 판단한다.
  const runRescheduleConfirmFlow = useCallback(
    (propose) => {
      const { schedule, newDraft, warnings } = propose;
      if (!schedule || !newDraft) {
        return announceAndFinish(warnings?.[0] || '옮길 예약을 찾지 못했어요.');
      }
      return runVoiceConfirmFlow({
        summary: buildRescheduleSummary(propose),
        onConfirm: () =>
          rescheduleReservation(schedule.id, newDraft).then(
            () => `${schedule.memberName ? schedule.memberName + '님 ' : ''}예약을 ${newDraft.date} ${newDraft.startTime}로 옮겼어요.`
          ),
        onCancelMessage: '알겠습니다, 예약은 그대로 둘게요.',
      });
    },
    [runVoiceConfirmFlow, announceAndFinish]
  );

  // [momi 쓰기 권한 확장 2026-08-10] memo_add_propose 결과(아직 저장 안 됨)를
  // 받으면 요약을 말해주고 확인을 기다린 뒤에만 실제로 메모에 이어붙인다.
  // 회원 자체를 못 찾았으면(ready:false 중에서도 member가 아예 없으면) 확인을
  // 받는 게 무의미하니 바로 안내한다 — 예약류의 hasBlockingIssue 패턴과 동일.
  const runMemoAddConfirmFlow = useCallback(
    (propose) => {
      const { member, memoText, warnings } = propose;
      if (!member || !memoText) {
        return announceAndFinish(warnings?.[0] || '메모를 추가할 회원이나 내용을 다시 말씀해주세요.');
      }
      return runVoiceConfirmFlow({
        summary: buildAddMemoSummary(propose),
        onConfirm: () => confirmAddMemberMemo({ member, memoText }).then(() => `${member.name}님 메모에 추가했어요.`),
        onCancelMessage: '알겠습니다, 메모는 추가하지 않을게요.',
      });
    },
    [runVoiceConfirmFlow, announceAndFinish]
  );

  // [momi 쓰기 권한 확장 2026-08-10] session_adjust_propose — 회원·트레이너를
  // 특정 못 했거나(ready:false) 차감 후 음수가 되는 경우는 확인 자체를 안 받고
  // 바로 안내한다(memberWriteService.proposeAdjustSessionCount가 이미 하드
  // 검증까지 마쳤으므로 여기선 ready만 보면 됨).
  const runSessionAdjustConfirmFlow = useCallback(
    (propose) => {
      const { member, trainerId, delta, warnings } = propose;
      if (!propose.ready || !member || !trainerId || !delta) {
        return announceAndFinish(warnings?.[0] || '세션을 조정할 회원·트레이너·횟수를 다시 말씀해주세요.');
      }
      return runVoiceConfirmFlow({
        summary: buildAdjustSessionSummary(propose),
        onConfirm: () =>
          confirmAdjustSessionCount({ member, trainerId, delta }).then(
            () => `${member.name}님 세션을 ${delta > 0 ? delta + '회 추가' : Math.abs(delta) + '회 차감'}했어요.`
          ),
        onCancelMessage: '알겠습니다, 세션은 그대로 둘게요.',
      });
    },
    [runVoiceConfirmFlow, announceAndFinish]
  );

  // [momi 쓰기 권한 확장 2026-08-10] member_info_update_propose — 회원을 못
  // 찾았거나 지원하지 않는 필드/빈 값이면 확인 없이 바로 안내한다.
  const runMemberInfoUpdateConfirmFlow = useCallback(
    (propose) => {
      const { member, field, newValue, warnings } = propose;
      if (!member || !field || !newValue) {
        return announceAndFinish(warnings?.[0] || '수정할 회원·정보·새 값을 다시 말씀해주세요.');
      }
      return runVoiceConfirmFlow({
        summary: buildUpdateInfoSummary(propose),
        onConfirm: () =>
          confirmUpdateMemberInfo({ member, field, newValue }).then(() => `${member.name}님 ${propose.fieldLabel}를 바꿨어요.`),
        onCancelMessage: '알겠습니다, 정보는 그대로 둘게요.',
      });
    },
    [runVoiceConfirmFlow, announceAndFinish]
  );

  const handleCommand = useCallback(
    async (transcript) => {
      if (isHandlingRef.current) {
        // [버그 수정 — 명령 겹침 2026-08-09] 위 isHandlingRef 선언부 설명 참고.
        // 이전 명령이 끝날 때까지 새 명령은 받지 않는다(조용히 무시하지만
        // 원인 파악용으로 콘솔엔 남긴다). busy 등 이전 명령의 상태는 건드리지
        // 않는다.
        console.warn('[모미] 이전 명령이 아직 처리 중이라 이번 명령은 건너뜁니다:', transcript);
        return;
      }
      isHandlingRef.current = true;
      setBusy(true);
      // [요청 흐름 2026-08-08] "모미야"→"네, 선생님"→(명령)→명령 인지 확인→
      // 실행/응답. 실제 처리(API 호출)로 넘어가기 전에 "들었다"는 걸 먼저
      // 알려줘서, 트레이너가 "제대로 들리긴 한 건가" 불안하게 기다리지 않게 한다.
      setFeedback('네, 확인했어요.');
      speak('네, 확인했어요.');
      // 화면 표시(feedback)와 음성 출력(speak)이 서로 다른 문구로 갈리지 않도록
      // 메시지를 한 곳에서만 만든다.
      let message = '';
      // [진단용 2026-08-08] "명령이 실행 안 된다"는 문의 대응 — 실패 원인(예:
      // API 크레딧 부족 등 서버 쪽 문제)을 화면에도 보여준다. 소리로는 안 읽음
      // (기술적 문구라 대화 흐름과 안 어울림) — 사과 메시지만 자연스럽게 말한다.
      let diagDetail = '';
      let handledSeparately = false;
      try {
        const result = await processVoiceCommand({
          transcript,
          role,
          currentUser: user,
          allMembers,
          navigate,
          mode: 'phone', // [예약 생성 프로젝트 2026-08-08] 폰/개인 기기 — 로그인된 본인 trainerId를 우선 신뢰.
          // [음성 대화형 2026-08-09] KioskVoiceCommand.jsx와 동일 — 직전 자유
          // 질문 왕복을 함께 보내서 후속 질문을 이어서 알아듣게 한다.
          history: getActiveHistory(chatHistoryRef, lastChatAtRef),
        });
        if (result.type === 'reservation_propose') {
          handledSeparately = true;
          clearHistory(chatHistoryRef, lastChatAtRef);
          await runReservationConfirmFlow(result.propose);
        } else if (result.type === 'reservation_cancel_propose') {
          handledSeparately = true;
          clearHistory(chatHistoryRef, lastChatAtRef);
          await runCancelConfirmFlow(result.propose);
        } else if (result.type === 'reservation_reschedule_propose') {
          handledSeparately = true;
          clearHistory(chatHistoryRef, lastChatAtRef);
          await runRescheduleConfirmFlow(result.propose);
        } else if (result.type === 'memo_add_propose') {
          handledSeparately = true;
          clearHistory(chatHistoryRef, lastChatAtRef);
          await runMemoAddConfirmFlow(result.propose);
        } else if (result.type === 'session_adjust_propose') {
          handledSeparately = true;
          clearHistory(chatHistoryRef, lastChatAtRef);
          await runSessionAdjustConfirmFlow(result.propose);
        } else if (result.type === 'member_info_update_propose') {
          handledSeparately = true;
          clearHistory(chatHistoryRef, lastChatAtRef);
          await runMemberInfoUpdateConfirmFlow(result.propose);
        } else if (result.type === 'timer_control') {
          // [음성 타이머 제어 2026-08-09] 예약류와 달리 확인 절차 없이 바로
          // 실행됐다(순수 UI 제어라 되돌릴 수 없는 부작용이 없음) — 결과만
          // 안내한다. 도구를 조작했으니 잡담 맥락은 정리.
          clearHistory(chatHistoryRef, lastChatAtRef);
          message = buildTimerControlMessage(result.cmd);
        } else if (result.type === 'chat') {
          message = result.text;
          recordChatTurn(chatHistoryRef, lastChatAtRef, transcript, result.text);
        } else {
          // type === 'navigate' — 화면을 실제로 옮겼으니 잡담 맥락은 정리.
          clearHistory(chatHistoryRef, lastChatAtRef);
          message = result.matchedMember
            ? `${result.matchedMember.name}님으로 이동할게요.`
            : '이동할게요.';
        }
      } catch (e) {
        message = '죄송해요, 잘 처리하지 못했어요. 다시 말씀해주세요.';
        diagDetail = e?.message || String(e);
        console.warn('[모미] 명령 처리 실패:', diagDetail);
      } finally {
        setBusy(false);
        if (!handledSeparately) {
          setFeedback(diagDetail ? `${message}\n[진단] ${diagDetail}` : message);
          speak(message);
          setTimeout(() => setFeedback(''), diagDetail ? 8000 : 4000);
        }
        isHandlingRef.current = false;
        // [마이크 자동 꺼짐 2026-08-11] 명령 하나(확인이 필요한 예약/메모/세션조정
        // 등은 "네/아니요"까지 다 끝난 뒤) 처리가 끝나면 자동으로 마이크를 끈다.
        // "모미야" 없이 버튼 눌러 켜는 방식이라 매번 다시 켜는 수고가 있지만,
        // 트레이너가 요청한 방식 — 켜둔 채 계속 듣게 두지 않는다(프라이버시 +
        // 의도치 않은 오작동 방지). 예약 확인처럼 awaitReply로 응답을 기다리는
        // 구간은 이 finally보다 먼저(위에서 await로) 끝나므로 그 사이엔 마이크가
        // 계속 켜져 있어 "네/아니요"를 정상적으로 들을 수 있다.
        stopListeningRef.current?.();
      }
    },
    [
      role, user, allMembers, navigate, speak,
      runReservationConfirmFlow, runCancelConfirmFlow, runRescheduleConfirmFlow,
      runMemoAddConfirmFlow, runSessionAdjustConfirmFlow, runMemberInfoUpdateConfirmFlow,
    ]
  );

  const handleWakeOnly = useCallback(() => {
    // "모미야"까지만 듣고 명령이 안 붙어 왔을 때 — 아무 반응이 없으면 트레이너
    // 입장에선 "불렀는데 반응이 없다"로 보이니, 들었다는 것만이라도 알려준다.
    const message = '네, 선생님.';
    setFeedback(message);
    speak(message);
    setTimeout(() => setFeedback(''), 3000);
  }, [speak]);

  const handleMismatch = useCallback((heard) => {
    // [진단용] 웨이크워드가 안 잡혔을 때 실제로 뭘로 들렸는지 화면에 잠깐
    // 보여준다 — 원격 디버깅(콘솔)이 막힌 기기가 많아서 화면이 유일한 창구.
    // heard가 빈 문자열이면(최종 결과인데 내용이 없었던 경우) 그것도 알려준다.
    // 소리 내어 읽지는 않는다(아무 말에나 계속 TTS가 끼어들면 방해가 됨).
    // [2026-08-08] "모미야"가 계속 무반응이라는 문의 때문에 노출 시간을 늘렸다
    // (4초→7초) — 이 문구를 놓치면 원인 파악이 안 되므로 눈에 띄는 시간을 확보.
    const shown = heard ? `"${heard}"` : '(빈 소리만 인식됨)';
    setFeedback(`[진단] 들림: ${shown}`);
    setTimeout(() => setFeedback(''), 7000);
  }, []);

  const handleErrorOccurred = useCallback((errorCode) => {
    // [진단용] 에러 코드를 사람이 읽을 수 있는 말로 바꿔서 화면에 보여준다.
    const KNOWN = {
      'not-allowed': '마이크 권한이 거부돼 있어요.',
      'audio-capture': '마이크 장치를 못 찾았어요.',
      network: '인터넷 연결을 확인해주세요.',
      // [버그 수정 2026-08-09] useMomiVoice.js가 재시작을 두 번(즉시+0.3초 뒤)
      // 시도해도 둘 다 실패했을 때만 온다. 여긴 버튼이 있으니 새로고침 대신
      // 버튼으로 끄고 다시 켜면 대부분 복구된다.
      'restart-failed': '음성 인식이 멈췄어요. 마이크 버튼을 다시 눌러주세요.',
    };
    const readable = KNOWN[errorCode] || `오류 코드: ${errorCode}`;
    setFeedback(`[진단] ${readable}`);
    // 마이크가 실제로 죽은 경우(restart-failed)는 놓치면 안 되니 더 오래 보여준다.
    setTimeout(() => setFeedback(''), errorCode === 'restart-failed' ? 15000 : 4000);
  }, []);

  const { supported, listening, startListening, stopListening, awaitReply } = useMomiVoice({
    onCommand: handleCommand,
    onWakeOnly: handleWakeOnly,
    onMismatch: handleMismatch,
    onErrorOccurred: handleErrorOccurred,
    // [버그 수정 — 웨이크워드 이중 요구 2026-08-09] 마이크 버튼을 직접 눌러서
    // 켜는 방식이라, 그 자체가 이미 "지금부터 나한테 말하는 거야"라는 명시적
    // 신호다 — 그 위에 "모미야"까지 요구하면 중복이다(실사용 스크린샷으로 확인:
    // 버튼 누르고 "회원 관리 들어가 줘"라고 또렷이 말해도 "모미야"가 없어서
    // 그냥 무시됐음). KioskVoiceCommand.jsx(항상 켜진 공용 기기)는 기본값
    // true를 그대로 써서 웨이크워드를 계속 요구한다.
    requireWakeWord: false,
  });

  // awaitReply는 useMomiVoice() 내부에서 deps:[]로 만들어진 안정적 함수라 사실상
  // 마운트 시 한 번만 바뀐다 — ref에 담아 runReservationConfirmFlow가 순환 의존
  // 없이 항상 최신 값을 참조하게 한다(위 awaitReplyRef 선언부 설명 참고).
  useEffect(() => {
    awaitReplyRef.current = awaitReply;
  }, [awaitReply]);

  // [마이크 자동 꺼짐 2026-08-11] stopListening도 같은 이유로 ref에 담는다.
  useEffect(() => {
    stopListeningRef.current = stopListening;
  }, [stopListening]);

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      // 예약 확인 흐름이 응답을 기다리는 중이면, 마이크를 끄기 전에 먼저
      // 풀어준다 — 안 그러면 busy가 안 풀려 이 버튼 자체가 먹통이 된다
      // (위 pendingConfirmResolveRef 설명 참고).
      if (pendingConfirmResolveRef.current) {
        pendingConfirmResolveRef.current();
      }
      stopListening();
      // 마이크를 끄면 모미가 말하던 중이어도 같이 멈춘다.
      stopSpeaking();
    } else {
      // iOS Safari 대응: 지금 이 탭 이벤트 안에서 미리 오디오를 잠금 해제해둬야
      // 나중에 "모미야" 응답을 비동기로 speak()할 때 소리가 나온다.
      unlockSpeech();
      startListening();
    }
  };

  return (
    // [버그 수정 2026-07] 데스크탑은 사이드바라 bottom:20이면 충분하지만, 모바일은
    // AppLayout의 하단 탭바(핵심 4개 + "전체")가 화면 맨 아래를 차지하고 있어
    // 마이크 버튼이 그 위에 겹쳐 "전체" 탭을 가렸다. 모바일 하단바 높이(~56px
    // + 아이콘/라벨 여백 + 아이폰 하단 안전영역)만큼 더 띄우고, md 이상(데스크탑)
    // 에서는 기존 20px 그대로 되돌린다 — AppLayout의 하단바 자체도 같은 md 기준으로
    // 나타났다 사라지므로 같은 기준선을 맞춘 것.
    <div
      className="fixed right-5 bottom-[calc(88px+env(safe-area-inset-bottom))] md:bottom-5"
      style={{ zIndex: 1000 }}
    >
      {feedback && (
        <div
          style={{
            marginBottom: 8,
            padding: '10px 14px',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.85)',
            color: '#fff',
            fontSize: 15,
            fontWeight: 500,
            maxWidth: 280,
            whiteSpace: 'pre-line',
            boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
          }}
        >
          {feedback}
        </div>
      )}
      <button
        onClick={toggle}
        aria-label={listening ? '음성 명령 끄기' : '음성 명령 켜기 (모미야)'}
        disabled={busy}
        style={{
          width: 52,
          height: 52,
          borderRadius: '50%',
          border: 'none',
          background: listening ? '#ef4444' : '#111827',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
          position: 'relative',
          cursor: busy ? 'default' : 'pointer',
          fontSize: 22,
          lineHeight: 1,
        }}
      >
        {listening ? '🎙️' : '🔇'}
        {listening && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#f87171',
              boxShadow: '0 0 0 2px #111827',
            }}
          />
        )}
      </button>
    </div>
  );
}
