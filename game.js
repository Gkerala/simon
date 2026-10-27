// ===== 버튼 정의 =====
// 북두칠성 7개 별을 왼쪽→오른쪽 순서로 배치 (보드 기준 % 좌표).
// 1~4: 손잡이(알카이드→메그레즈), 4~7: 국자(메그레즈→펙다→메락→두베)
const BUTTONS = [
  { x: 6,  y: 28, color: '#ff0000', freq: 261.63 }, // 1 빨강 도 C4
  { x: 22, y: 20, color: '#ff8c00', freq: 293.66 }, // 2 주황 레 D4
  { x: 36, y: 27, color: '#ffff00', freq: 329.63 }, // 3 노랑 미 E4
  { x: 50, y: 38, color: '#00c000', freq: 349.23 }, // 4 초록 파 F4
  { x: 56, y: 72, color: '#0060ff', freq: 392.00 }, // 5 파랑 솔 G4
  { x: 84, y: 80, color: '#2a1fa0', freq: 440.00 }, // 6 남색 라 A4
  { x: 92, y: 42, color: '#a020f0', freq: 493.88 }, // 7 보라 시 B4
];

const FLASH_MS = 500;   // 버튼 활성화 시간
const GAP_MS = 300;     // 시연 시 버튼 사이 간격
const CLEAR_MS = 1500;  // STAGE CLEAR 후 다음 스테이지까지

const $ = (id) => document.getElementById(id);
const board = $('board');

// ===== 게임 상태 =====
let state = 'READY'; // READY | COMPUTER_TURN | PLAYER_TURN | STAGE_CLEAR | FAILED
let stage = 1;
let score = 0;
let sequence = [];   // 이번 스테이지의 정답 순서 (버튼 인덱스)
let inputIndex = 0;  // 플레이어가 다음에 맞춰야 할 위치
let timeLimit = 0;   // 초
let deadline = 0;    // performance.now() 기준 종료 시각
let timerId = null;

// 상태가 바뀔 때마다 증가. 예약된 setTimeout이 실행될 때 세대가 다르면 무시해서
// 이전 상태의 애니메이션/전환이 중복 실행되지 않게 함.
let generation = 0;
function later(fn, ms) {
  const gen = generation;
  setTimeout(() => { if (gen === generation) fn(); }, ms);
}

// ===== 소리 (Web Audio API) =====
let audioCtx = null;
function playTone(freq) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  // 짧은 어택/릴리즈로 클릭음 방지
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.4, t + 0.02);
  gain.gain.setValueAtTime(0.4, t + FLASH_MS / 1000 - 0.05);
  gain.gain.linearRampToValueAtTime(0, t + FLASH_MS / 1000);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + FLASH_MS / 1000);
}

// ===== 버튼 생성 및 활성화 =====
const starEls = BUTTONS.map((b, i) => {
  const el = document.createElement('button');
  el.className = 'star';
  el.style.left = b.x + '%';
  el.style.top = b.y + '%';
  el.style.setProperty('--color', b.color);
  el.addEventListener('pointerdown', () => onPlayerInput(i));
  board.appendChild(el);
  return el;
});

// 한 번에 하나의 버튼만 빛나도록, 새 버튼을 켜면 이전 버튼은 즉시 끔
let litIndex = -1;
let litTimer = null;
function flash(i) {
  clearTimeout(litTimer);
  if (litIndex >= 0) starEls[litIndex].classList.remove('lit');
  litIndex = i;
  starEls[i].classList.add('lit');
  playTone(BUTTONS[i].freq);
  litTimer = setTimeout(clearLit, FLASH_MS);
}
function clearLit() {
  clearTimeout(litTimer);
  if (litIndex >= 0) starEls[litIndex].classList.remove('lit');
  litIndex = -1;
}

// ===== 화면 표시 =====
function updateInfo(remaining = timeLimit) {
  $('stage').textContent = stage;
  $('time').textContent = Math.max(0, remaining).toFixed(1);
  $('score').textContent = score;
}
function showMessage(text, ms) {
  $('message').textContent = text;
  if (ms) later(() => { $('message').textContent = ''; }, ms);
}

// 상태 전환: 세대 증가 + 타이머 정지 + 중앙 UI 정리
function setState(next) {
  state = next;
  generation++;
  clearInterval(timerId);
  $('message').textContent = '';
  $('startBtn').hidden = next !== 'READY';
  $('failPanel').hidden = next !== 'FAILED';
}

// ===== 게임 흐름 =====
function startStage() {
  setState('COMPUTER_TURN');
  clearLit();
  // 스테이지 번호만큼 새 무작위 순서 생성 (중복 허용, 누적 없음)
  sequence = Array.from({ length: stage }, () => Math.floor(Math.random() * BUTTONS.length));
  inputIndex = 0;
  timeLimit = 5 + stage * 2;
  updateInfo();
  // 버튼 i는 i*(0.5+0.3)초에 켜짐
  sequence.forEach((b, i) => later(() => flash(b), 500 + i * (FLASH_MS + GAP_MS)));
  later(startPlayerTurn, 500 + sequence.length * (FLASH_MS + GAP_MS));
}

function startPlayerTurn() {
  setState('PLAYER_TURN');
  showMessage('START', 1000);
  // 실제 경과시간 기준으로 남은 시간 계산 (누적 오차 없음)
  deadline = performance.now() + timeLimit * 1000;
  timerId = setInterval(() => {
    const remaining = (deadline - performance.now()) / 1000;
    updateInfo(remaining);
    if (remaining <= 0) fail();
  }, 50);
}

function onPlayerInput(i) {
  if (state !== 'PLAYER_TURN') return; // 시연 중/종료 후 입력 무시
  const remaining = (deadline - performance.now()) / 1000;
  if (remaining <= 0) return fail();
  flash(i);
  if (i !== sequence[inputIndex]) return fail();
  inputIndex++;
  if (inputIndex === sequence.length) clear(remaining);
}

function clear(remaining) {
  setState('STAGE_CLEAR');
  score += 1 + Math.floor(remaining);
  updateInfo(remaining);
  showMessage('STAGE CLEAR');
  later(() => { stage++; startStage(); }, CLEAR_MS);
}

function fail() {
  const remaining = (deadline - performance.now()) / 1000;
  setState('FAILED');
  updateInfo(remaining);
  $('failInfo').textContent = `Stage ${stage} · Score ${score}`;
}

function goMain() {
  setState('READY');
  clearLit();
  stage = 1;
  score = 0;
  timeLimit = 0;
  updateInfo();
}

$('startBtn').addEventListener('click', () => {
  // 브라우저 정책상 사용자 클릭 시점에 오디오 컨텍스트 생성/재개
  audioCtx ??= new AudioContext();
  audioCtx.resume();
  stage = 1;
  score = 0;
  startStage();
});
$('retryBtn').addEventListener('click', startStage); // 스테이지·점수 유지, 새 순서
$('mainBtn').addEventListener('click', goMain);

goMain();
