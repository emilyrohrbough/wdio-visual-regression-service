import _ from 'lodash';
import { parse as parsePlatform } from 'platform';
import { makeElementScreenshot, makeDocumentScreenshot, makeViewportScreenshot } from 'wdio-screenshot';

import getUserAgent from './scripts/getUserAgent';
import { mapViewports, mapOrientations } from './modules/resolutionMapUtils';

export default class VisualRegressionLauncher {
  constructor() {
    this.currentSuite = null;
    this.currentTest = null;
  }

  /**
   * Gets executed once before all workers get launched.
   * @param {Object} config wdio configuration object
   * @param {Array.<Object>} capabilities list of capabilities details
   */
  async onPrepare(config) {
    this.validateConfig(config);
    this.compare = config.visualRegression.compare;
    await this.runHook('onPrepare');
  }

  /**
   * Gets executed before test execution begins. At this point you can access
   * all global variables, such as `browser`.
   * It is the perfect place to define custom commands.
   * @param  {object} capabilities desiredCapabilities
   * @param  {[type]} specs        [description]
   * @return {Promise}
   */
  async before(capabilities, specs) {
    this.validateConfig(browser.options);

    const visualRegressionConfig = browser.options.visualRegression;

    // this.compare = browser.options.visualRegression.compare;
    this.compare = visualRegressionConfig.compare;
    this.viewportChangePause = visualRegressionConfig.viewportChangePause || 100;
    this.viewports = visualRegressionConfig.viewports;
    this.orientations = visualRegressionConfig.orientations;
    const userAgent = (await browser.execute(getUserAgent)).value;
    const { name, version, ua } = parsePlatform(userAgent);

    this.context = {
      browser: {
        name,
        version,
        userAgent: ua
      },
      desiredCapabilities: capabilities,
      specs: specs
    };

    browser.addCommand('checkElement', this.wrapCommand(browser, 'element', makeElementScreenshot));
    browser.addCommand('checkDocument', this.wrapCommand(browser, 'document', makeDocumentScreenshot));
    browser.addCommand('checkViewport', this.wrapCommand(browser, 'viewport', makeViewportScreenshot));

    await this.runHook('before', this.context);
  }

  /**
   * Hook that gets executed before the suite starts
   * @param {Object} suite suite details
   */
  beforeSuite (suite) {
    this.currentSuite = suite;
  }

  /**
   * Hook that gets executed after the suite has ended
   * @param {Object} suite suite details
   */
  afterSuite(suite) {
    this.currentSuite = null;
  }

  /**
   * Function to be executed before a test (in Mocha/Jasmine) or a step (in Cucumber) starts.
   * @param {Object} test test details
   */
  beforeTest(test) {
    this.currentTest = test;
  }

  /**
   * Function to be executed after a test (in Mocha/Jasmine) or a step (in Cucumber) ends.
   * @param {Object} test test details
   */
  afterTest(test) {
    this.currentTest = null;
  }

  /**
   * Gets executed after all tests are done. You still have access to all global
   * variables from the test.
   * @param  {object} capabilities desiredCapabilities
   * @param  {[type]} specs        [description]
   * @return {Promise}
   */
  async after(capabilities, specs) {
    await this.runHook('after', capabilities, specs);
  }

  /**
   * Gets executed after all workers got shut down and the process is about to exit.
   * @param {Object} exitCode 0 - success, 1 - fail
   * @param {Object} config wdio configuration object
   * @param {Array.<Object>} capabilities list of capabilities details
   */
  async onComplete(exitCode, config, capabilities) {
    await this.runHook('onComplete');
  }

  async runHook(hookName, ...args) {
    if (typeof this.compare[hookName] === 'function') {
      return await this.compare[hookName](...args)
    }
  }

  validateConfig(config) {
    if(!_.isPlainObject(config.visualRegression) || !_.has(config.visualRegression, 'compare')) {
      throw new Error('Please provide a visualRegression configuration with a compare method in your wdio-conf.js!');
    }
  }

  wrapCommand(browser, type, command) {
    const baseContext = {
      type,
      browser: this.context.browser,
      desiredCapabilities: this.context.desiredCapabilities,
    };

    const runHook = this.runHook.bind(this);

    const getTestDetails = () => this.getTestDetails();

    let resolutionKey = 'viewport';
    let resolutionOptions = options.viewports;
    let resolutionMap = mapViewports;
    let resolutionDefault = this.viewports;

    if (browser.isMobile) {
      resolutionKey = 'orientation';
      resolutionOptions = options.orientations;
      resolutionMap = mapOrientations;
      resolutionDefault = this.orientations;
    }

    return async function async(...args) {
      const url = await browser.getUrl();

      const elementSelector = type === 'element' ? args[0] : undefined;
      let options = _.isPlainObject(args[args.length - 1]) ? args[args.length - 1] : {};

      const {
        exclude,
        hide,
        remove,
      } = options;

      const resolutions = resolutionOptions || resolutionDefault;
      const viewportChangePause = options.viewportChangePause || this.viewportChangePause;

      const results = await resolutionMap(
        browser,
        viewportChangePause,
        resolutions,
        async function takeScreenshot(resolution) {
          const meta = {
            url,
            element: elementSelector,
            exclude,
            hide,
            remove,
            [resolutionKey]: resolution
          };

          const screenshotContext = {
            ...baseContext,
            ...getTestDetails(),
            meta,
            options
          };

          // const screenshotContextCleaned = _.pickBy(screenshotContext, _.identity);

          await runHook('beforeScreenshot', screenshotContext);

          const base64Screenshot = await command(browser, ...args);

          await runHook('afterScreenshot', screenshotContext, base64Screenshot);

          // pass the following params to next iteratee function
          return [screenshotContext, base64Screenshot];
        },
        async function processScreenshot(screenshotContext, base64Screenshot) {
          return await runHook('processScreenshot', screenshotContext, base64Screenshot);
        }
      );
      return results;

    }
  }

  getTestDetails() {
    return {
     suite: this.currentSuite,
     test: this.currentTest,
    };
  }
}
