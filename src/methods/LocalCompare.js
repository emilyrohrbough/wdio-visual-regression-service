import fs from 'fs-extra';
import resemble from 'node-resemble-js';
import BaseCompare from './BaseCompare';
import debug from 'debug';

const log = debug('wdio-visual-regression-service:LocalCompare');

export default class LocalCompare extends BaseCompare {

  constructor(options = {}) {
    super();
    this.getScreenshotName = options.screenshotName;
    this.getReferenceName = options.referenceName;
    this.getDiffName = options.diffName;
    this.misMatchTolerance = options.misMatchTolerance || 0.01;
    this.ignoreComparison = options.ignoreComparison || 'nothing';
  }

  async processScreenshot(context, base64Screenshot) {
    const screenshotPath = this.getScreenshotName(context);
    const referencePath = this.getReferenceName(context);

    await fs.outputFile(screenshotPath, base64Screenshot, 'base64');

    const referenceExists = await fs.exists(referencePath);

    if (referenceExists) {
      log('reference exists, compare it with the taken now');
      const captured = new Buffer(base64Screenshot, 'base64');
      const ignoreComparison = context.ignoreComparison || this.ignoreComparison;

      const compareData = await this.compareImages(referencePath, captured, ignoreComparison);

      const { isSameDimensions } = compareData;
      const misMatchPercentage = Number(compareData.misMatchPercentage);
      const misMatchTolerance = context.misMatchTolerance || this.misMatchTolerance;
      const isWithinMisMatchTolerance = misMatchPercentage < misMatchTolerance;

      const diffPath = this.getDiffName(context);

      if (isSameDimensions && isWithinMisMatchTolerance) {
        log(`Image is within tolerance or the same`);
        await fs.remove(diffPath);
      } else {
        log(`Image is different! ${misMatchPercentage}%`);
        const png = compareData.getDiffImage().pack();
        await this.writeDiff(png, diffPath);
      }

      return this.createResultReport({ misMatchPercentage, isWithinMisMatchTolerance, isSameDimensions, referenceExists });
    } else {
      log('first run - create reference file');
      await fs.outputFile(referencePath, base64Screenshot, 'base64');
      return this.createResultReport({ misMatchPercentage: 0, isWithinMisMatchTolerance: true, isSameDimensions: true, referenceExists });
    }
  }

  /**
   * Compares two images with resemble
   * @param  {Buffer|string} reference path to reference file or buffer
   * @param  {Buffer|string} screenshot path to file or buffer to compare with reference
   * @return {{misMatchPercentage: Number, isSameDimensions:Boolean, getImageDataUrl: function}}
   */
  async compareImages(reference, screenshot, ignore = '') {
    return await new Promise((resolve) => {
      const image = resemble(reference).compareTo(screenshot);

      switch(ignore) {
        case 'colors':
          image.ignoreColors();
          break;
        case 'antialiasing':
          image.ignoreAntialiasing();
          break;
      }

      image.onComplete((data) => {
        resolve(data);
      });
    });
  }

  /**
   * Writes provided diff by resemble as png
   * @param  {Stream} png node-png file Stream.
   * @return {Promise}
   */
  async writeDiff(png, filepath) {
    await new Promise((resolve, reject) => {
      const chunks = [];
      png.on('data', function(chunk) {
        chunks.push(chunk);
      });
      png.on('end', () => {
        const buffer = Buffer.concat(chunks);

        Promise
        .resolve()
        .then(() => fs.outputFile(filepath, buffer.toString('base64'), 'base64'))
        .then(() => resolve())
        .catch(reject);
      });
      png.on('error', (err) => reject(err));
    });
  }
}
