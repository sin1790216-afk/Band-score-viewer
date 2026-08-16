// "그대만 있다면-멜로디.pdf"의 오염 회귀에 필요한 정규화 metadata만 보존한다.
export const TARGET_LYRIC_SYSTEM = {
  contentBottom: 0.39424533064109035,
  contentTop: 0.3028773346794548,
  index: 1,
  staffBottom: 0.3642099949520444,
  staffSpacing: 0.005805148914689551,
  staffTop: 0.3409893992932862,
  width: 0.87,
  x: 0.07,
};

export const TARGET_NEXT_SYSTEM = {
  contentBottom: 0.47930338213023727,
  contentTop: 0.39424533064109035,
  index: 2,
  staffBottom: 0.4475012619888945,
  staffSpacing: 0.005805148914689551,
  staffTop: 0.4242806663301363,
  width: 0.87,
  x: 0.07,
};

function item({
  baselineY,
  fontFamily,
  fontName,
  height,
  text,
  width,
  x,
}) {
  return {
    baselineY,
    fontFamily,
    fontName,
    height,
    page: 1,
    text,
    width,
    x,
    y: baselineY - height,
  };
}

export const TARGET_LYRIC_TEXT_ITEMS = [
  item({
    baselineY: 0.3875768408551069,
    fontFamily: 'monospace',
    fontName: 'g_target_lyric',
    height: 0.01154394299287411,
    text: '눈 물짓－ 던 그 대의－',
    width: 0.17136150858648103,
    x: 0.12408857854685218,
  }),
  item({
    baselineY: 0.3875768408551069,
    fontFamily: 'monospace',
    fontName: 'g_target_lyric',
    height: 0.01154394299287411,
    text: '말',
    width: 0.016329,
    x: 0.313,
  }),
  item({
    baselineY: 0.41144857482185276,
    fontFamily: 'sans-serif',
    fontName: 'g_target_chord',
    height: 0.010617577197149643,
    text: 'm',
    width: 0.012511374576360399,
    x: 0.1319512179673676,
  }),
  item({
    baselineY: 0.4121611638954869,
    fontFamily: 'sans-serif',
    fontName: 'g_target_chord',
    height: 0.01154394299287411,
    text: 'E',
    width: 0.010892174871081697,
    x: 0.22085952526088803,
  }),
  item({
    baselineY: 0.4121611638954869,
    fontFamily: 'sans-serif',
    fontName: 'g_target_chord',
    height: 0.01154394299287411,
    text: '/D',
    width: 0.01622885065499405,
    x: 0.25,
  }),
  item({
    baselineY: 0.44201864608076014,
    fontFamily: 'sans-serif',
    fontName: 'g_target_notation',
    height: 0.02315914489311164,
    text: '& b',
    width: 0.039509763088089934,
    x: 0.05453446059613894,
  }),
  item({
    baselineY: 0.4475012619888945,
    fontFamily: 'sans-serif',
    fontName: 'g_target_notation',
    height: 0.02315914489311164,
    text: 'œ œ',
    width: 0.04,
    x: 0.2,
  }),
  item({
    baselineY: 0.4709497624703088,
    fontFamily: 'monospace',
    fontName: 'g_target_lyric',
    height: 0.01154394299287411,
    text: '그 대가－ 힘 들 어하 －',
    width: 0.17547669309549543,
    x: 0.12408857854685218,
  }),
];

export const TARGET_MEASURE = {
  height: 0.0913679959616356,
  id: 'target-measure',
  lyric: '',
  measureIndex: 3,
  page: 1,
  width: 0.4,
  x: 0.07,
  y: 0.3028773346794548,
};
