// Prints what Chrome computes for the named easings, to use as reference
// values in packages/core/test/easing.test.ts.
// Run with: node tests/reference-values.cjs
const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const values = await page.evaluate(() => {
    const element = document.body.appendChild(document.createElement('div'));
    const result = {};
    for (const easing of ['ease', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(0.34, 1.56, 0.64, 1)']) {
      // Opacity cannot show an overshoot (it is clamped to 1), so read a length.
      const animation = element.animate({ marginLeft: ['0px', '1000px'] }, { duration: 1000, easing });
      animation.pause();
      result[easing] = [250, 500, 750].map((time) => {
        animation.currentTime = time;
        return parseFloat(getComputedStyle(element).marginLeft) / 1000;
      });
      animation.cancel();
    }
    // Inputs outside 0 to 1: an effect easing that outputs 1.5 or -0.5
    // feeds the keyframe easing under test.
    for (const easing of ['ease-in', 'ease-out', 'ease', 'steps(4)', 'steps(4, start)']) {
      result[`${easing} at 1.5 and -0.5`] = ['linear(1.5, 1.5)', 'linear(-0.5, -0.5)'].map((effect) => {
        const animation = element.animate(
          [{ marginLeft: '0px', easing }, { marginLeft: '1000px' }],
          { duration: 1000, easing: effect },
        );
        animation.pause();
        animation.currentTime = 500;
        const value = parseFloat(getComputedStyle(element).marginLeft) / 1000;
        animation.cancel();
        return value;
      });
    }
    return result;
  });
  console.log(browser.version(), JSON.stringify(values, null, 1));
  await browser.close();
})();
