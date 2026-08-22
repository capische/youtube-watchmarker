(() => {
    'use strict';

    const funcClean = function(strValue) {
        return (strValue || '').replace(/\s+/g, ' ').trim();
    };

    const funcIdent = function() {
        if (window.location.pathname === '/watch') {
            const strIdent = new URLSearchParams(window.location.search).get('v');
            return ((strIdent || '').length === 11) ? strIdent : null;
        }

        if (window.location.pathname.indexOf('/shorts/') === 0) {
            const strIdent = window.location.pathname.split('/shorts/')[1].slice(0, 11);
            return strIdent.length === 11 ? strIdent : null;
        }

        return null;
    };

    const funcText = function(objSelectors) {
        for (let strSelector of objSelectors) {
            const objElement = window.document.querySelector(strSelector);

            if (objElement !== null) {
                const strText = funcClean(objElement.getAttribute('content') || objElement.textContent || '');

                if (strText !== '') {
                    return strText;
                }
            }
        }

        return '';
    };

    const funcMeta = function(objSelectors) {
        for (let strSelector of objSelectors) {
            const objElement = window.document.querySelector(strSelector);

            if (objElement !== null) {
                const strText = funcClean(objElement.getAttribute('content') || objElement.getAttribute('datetime') || '');

                if (strText !== '') {
                    return strText;
                }
            }
        }

        return '';
    };

    const funcViews = function(strValue) {
        const intViews = Number(String(strValue || '').replace(/[^\d]/g, ''));

        if ((intViews > 0) && (Number.isFinite(intViews) === true)) {
            return new Intl.NumberFormat(undefined, {
                'maximumFractionDigits': 1,
                'notation': 'compact',
            }).format(intViews) + ' views';
        }

        return '';
    };

    const funcPublished = function(strValue) {
        const intTimestamp = Date.parse(strValue || '');

        if (Number.isFinite(intTimestamp) === false) {
            return '';
        }

        const intDays = Math.max(0, Math.floor((Date.now() - intTimestamp) / 86400000));

        if (intDays === 0) {
            return 'today';
        }

        if (intDays === 1) {
            return 'yesterday';
        }

        const objUnits = [
            { 'intSize': 365, 'strName': 'year' },
            { 'intSize': 30, 'strName': 'month' },
            { 'intSize': 7, 'strName': 'week' },
        ];

        for (let objUnit of objUnits) {
            if (intDays >= objUnit.intSize) {
                const intValue = Math.floor(intDays / objUnit.intSize);
                return intValue + ' ' + objUnit.strName + (intValue === 1 ? '' : 's') + ' ago';
            }
        }

        return intDays + ' days ago';
    };

    const funcPlayerResponse = function() {
        if ((window.ytInitialPlayerResponse !== undefined) && (window.ytInitialPlayerResponse !== null)) {
            return window.ytInitialPlayerResponse;
        }

        for (let objScript of window.document.querySelectorAll('script')) {
            const strText = objScript.textContent || '';
            const intStart = strText.indexOf('ytInitialPlayerResponse');

            if (intStart === -1) {
                continue;
            }

            const intBrace = strText.indexOf('{', intStart);

            if (intBrace === -1) {
                continue;
            }

            let intDepth = 0;
            let boolString = false;
            let boolEscape = false;

            for (let intIndex = intBrace; intIndex < strText.length; intIndex += 1) {
                const strChar = strText[intIndex];

                if (boolString === true) {
                    if (boolEscape === true) {
                        boolEscape = false;
                    } else if (strChar === '\\') {
                        boolEscape = true;
                    } else if (strChar === '"') {
                        boolString = false;
                    }

                    continue;
                }

                if (strChar === '"') {
                    boolString = true;
                } else if (strChar === '{') {
                    intDepth += 1;
                } else if (strChar === '}') {
                    intDepth -= 1;

                    if (intDepth === 0) {
                        try {
                            return JSON.parse(strText.slice(intBrace, intIndex + 1));
                        } catch (objError) {
                            break;
                        }
                    }
                }
            }
        }

        return null;
    };

    const funcDurationText = function(intSeconds) {
        if ((Number.isFinite(intSeconds) === false) || (intSeconds <= 0)) {
            return '';
        }

        const objParts = [];

        while (intSeconds >= 60) {
            objParts.unshift(String(intSeconds % 60).padStart(2, '0'));
            intSeconds = Math.floor(intSeconds / 60);
        }

        objParts.unshift(String(intSeconds));
        return objParts.join(':');
    };

    const funcDuration = function() {
        const objVideo = window.document.querySelector('video.html5-main-video') || window.document.querySelector('.html5-video-player video') || window.document.querySelector('video');

        if ((objVideo !== null) && (objVideo.duration) && (isNaN(objVideo.duration) === false) && (objVideo.duration > 0)) {
            return funcDurationText(Math.round(objVideo.duration));
        }

        const strPlayerDuration = funcText([
            '.ytp-time-duration',
            'span.ytp-time-duration',
            '.ytp-time-display .ytp-time-duration',
            '#movie_player .ytp-time-duration',
        ]);

        if (strPlayerDuration !== '') {
            return strPlayerDuration;
        }

        const objPlayer = funcPlayerResponse();
        const intSeconds = Number((((objPlayer || {}).videoDetails || {}).lengthSeconds || 0));
        return funcDurationText(intSeconds);
    };

    const funcInfo = function() {
        const objTexts = Array.from(window.document.querySelectorAll([
            'ytd-watch-info-text span',
            'ytd-watch-metadata #info span',
            '#info span',
            '#info-text span',
            '#metadata-line span',
        ].join(', '))).map(function(objElement) {
            return funcClean(objElement.textContent || '');
        }).filter(function(strText, intIndex, objArray) {
            return (strText !== '') && (objArray.indexOf(strText) === intIndex);
        });

        let strViews = '';
        let strPublished = '';

        for (let strText of objTexts) {
            if ((strViews === '') && (/\bviews?\b/i.test(strText) === true)) {
                strViews = strText;
            }

            if ((strPublished === '') && (/(ago|premiered|streamed|started|scheduled|today|yesterday|\d{4})/i.test(strText) === true) && (/\bviews?\b/i.test(strText) === false)) {
                strPublished = strText;
            }
        }

        if (strViews === '') {
            strViews = funcViews(funcMeta([
                'meta[itemprop="interactionCount"]',
                'meta[name="interactionCount"]',
            ]));
        }

        if (strPublished === '') {
            strPublished = funcPublished(funcMeta([
                'meta[itemprop="datePublished"]',
                'meta[itemprop="uploadDate"]',
                'meta[name="datePublished"]',
            ]));
        }

        return { 'strViews': strViews, 'strPublished': strPublished };
    };

    const funcMetadata = function() {
        const strIdent = funcIdent();

        if (strIdent === null) {
            return null;
        }

        const objInfo = funcInfo();
        let strTitle = funcText([
            'ytd-watch-metadata h1 yt-formatted-string',
            'h1.ytd-watch-metadata',
            'meta[name="title"]',
            'meta[property="og:title"]',
        ]);

        if (strTitle.slice(-10) === ' - YouTube') {
            strTitle = strTitle.slice(0, -10);
        }

        const objPlayer = funcPlayerResponse();

        if (strTitle === '') {
            strTitle = funcClean(((objPlayer || {}).videoDetails || {}).title || '');
        }

        if (strTitle === '') {
            strTitle = funcClean(window.document.title.replace(/ - YouTube$/, '').replace(/^\(\d+\)\s*/, ''));
        }

        const strChannel = funcText([
            'ytd-watch-metadata ytd-channel-name a',
            'ytd-watch-metadata #owner a.yt-simple-endpoint',
            '#owner ytd-channel-name a',
            '#owner #channel-name a',
            'ytd-video-owner-renderer #channel-name a',
            'yt-content-metadata-view-model a',
            'link[itemprop="name"]',
            'span[itemprop="author"] link[itemprop="name"]',
        ]) || funcClean((((objPlayer || {}).videoDetails || {}).author || ''));

        const boolVerified = window.document.querySelector([
            'ytd-watch-metadata #owner ytd-badge-supported-renderer',
            '#owner ytd-badge-supported-renderer',
            'ytd-video-owner-renderer ytd-badge-supported-renderer',
        ].join(', ')) !== null;

        return {
            'strIdent': strIdent,
            'strUrl': window.location.pathname.indexOf('/shorts/') === 0 ? 'https://www.youtube.com/shorts/' + strIdent : 'https://www.youtube.com/watch?v=' + strIdent,
            'strKind': window.location.pathname.indexOf('/shorts/') === 0 ? 'shorts' : 'watch',
            'strTitle': strTitle || 'YouTube video',
            'strChannel': strChannel,
            'strViews': objInfo.strViews,
            'strPublished': objInfo.strPublished,
            'strDuration': funcDuration(),
            'strThumbnail': 'https://i.ytimg.com/vi/' + strIdent + '/hqdefault.jpg',
            'boolVerified': boolVerified,
        };
    };

    chrome.runtime.onMessage.addListener(function(objRequest, objSender, funcResponse) {
        if (objRequest.strMessage === 'watchlist:collect') {
            funcResponse(funcMetadata());
            return true;
        }

        return false;
    });
})();
