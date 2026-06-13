// 選考ステージの定義（ホーム / 選考管理が共有）。
export const STAGES = [
  '気になる', 'インターン', 'エントリー', 'ES', 'Webテスト', '一次面接', '最終面接', '内定',
];
// 進捗の枠外（終了）の状態
export const OUTCOMES = ['お祈り', '辞退'];

export const ALL_STATES = [...STAGES, ...OUTCOMES];

export function isOutcome(stage) {
  return OUTCOMES.includes(stage);
}

// 進捗バーの割合（0-100）。未設定は0、内定は100、終了状態は100（色で区別）。
export function stageProgress(stage) {
  const i = STAGES.indexOf(stage);
  if (i >= 0) return Math.round(((i + 1) / STAGES.length) * 100);
  if (isOutcome(stage)) return 100;
  return 0;
}

// ステージのラベル「一次面接（6/8）」
export function stageLabel(stage) {
  const i = STAGES.indexOf(stage);
  if (i >= 0) return `${stage}（${i + 1}/${STAGES.length}）`;
  return stage || '気になる';
}

// 「選考中」とみなすか（ホームの集計用）。気になる/内定/終了 は除く。
export function isActive(stage) {
  return STAGES.includes(stage) && stage !== '気になる' && stage !== '内定';
}
