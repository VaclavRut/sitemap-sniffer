const Apify = require('apify');

const possibleXmlUrls = require('./consts');
const { log } = Apify.utils;

Apify.main(async () => {
    let { url, proxy } = await Apify.getInput();
    if (url.match(/\/$/) !== null) {
        url = url.replace(/\/$/, '');
    }

    // Open a request queue and add a start URL to it
    const requestQueue = await Apify.openRequestQueue();
    for (const item of possibleXmlUrls) {
        await requestQueue.addRequest({ url: `${url}${item}` });
    }

    const crawler = new Apify.PuppeteerCrawler({
        requestQueue,
        useSessionPool: true,
        maxConcurrency: 1,
        puppeteerPoolOptions: {
            maxOpenPagesPerInstance: 1,
            retireInstanceAfterRequestCount: 80,
        },
        launchPuppeteerOptions: {
            ...proxy,
            stealth: true,
            useChrome: true,
        },
        // This function is called for every page the crawler visits
        handlePageFunction: async ({ request, page, response, session }) => {
            const responseStatus = response.status();
            if(responseStatus === 403){
                session.retire();
                request.retryCount--;
                await Apify.utils.sleep(5000);
                throw new Error('Session blocked, retiring.');
            }
            const htmlRaw = await page.evaluate(() => {
                return document.querySelector('body').innerText.trim();
            });

            const key = `html_${Math.random()}`;
            await Apify.setValue(`${key}.html`, htmlRaw, { contentType: 'text/html' });
            const htmlUrl = `https://api.apify.com/v2/key-value-stores/${Apify.getEnv().defaultKeyValueStoreId}/records/${key}.html?disableRedirect=true`;

            await Apify.setValue(`html_${Math.random()}`, htmlRaw, { contentType: 'text/html' });
            await Apify.pushData({
                url: request.url,
                loadedUrl: request.loadedUrl,
                statusCode: responseStatus,
                htmlUrl,
            });

            log.info(`${request.url} checked, status ${responseStatus}`);
        },

        // This function is called for every page the crawler failed to load
        // or for which the handlePageFunction() throws at least "maxRequestRetries"-times
        handleFailedRequestFunction: async ({ request }) => {
            console.log(`Request ${request.url} failed too many times`);
            await Apify.pushData({
                '#debug': Apify.utils.createRequestDebugInfo(request),
            });
        },

        maxRequestRetries: 2,
        maxRequestsPerCrawl: 100,
        maxConcurrency: 10,
    });

    await crawler.run();
});
