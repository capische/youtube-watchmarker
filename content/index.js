'use strict';

let objDatabase = chrome.runtime.connect({
    'name': 'database',
});

let objWatchlist = chrome.runtime.connect({
    'name': 'watchlist',
});

let objHistory = chrome.runtime.connect({
    'name': 'history',
});

let objYoutube = chrome.runtime.connect({
    'name': 'youtube',
});

let objSearch = chrome.runtime.connect({
    'name': 'search',
});

let funcStorageget = async function(strKey) {
    let objValue = await chrome.storage.local.get(strKey);

    if (objValue[strKey] === undefined) {
        return null;
    }

    return String(objValue[strKey]);
};

let funcStorageset = async function(strKey, objValue) {
     await chrome.storage.local.set({ [strKey]: String(objValue) });
};

let funcBackupname = function(strExtension) {
    return new Date().getFullYear() + '.' + ('0' + (new Date().getMonth() + 1)).slice(-2) + '.' + ('0' + new Date().getDate()).slice(-2) + '.' + strExtension;
};

let funcEncodebackup = function(objValue) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(objValue))));
};

let funcDecodebackup = function(strValue) {
    return JSON.parse(decodeURIComponent(escape(atob(strValue))));
};

let funcPortrequest = async function(objPort, strMessage, objRequest, funcProgress) {
    return await new Promise(function(funcResolve) {
        const funcListener = function(objData) {
            if (objData.strMessage === strMessage) {
                objPort.onMessage.removeListener(funcListener);
                funcResolve(objData.objResponse);

            } else if (objData.strMessage === strMessage + '-progress') {
                if (funcProgress !== undefined) {
                    funcProgress(objData.objResponse);
                }
            }
        };

        objPort.onMessage.addListener(funcListener);

        objPort.postMessage({
            'strMessage': strMessage,
            'objRequest': objRequest,
        });
    });
};

let funcShowloading = function(strMessage) {
    jQuery('#idLoading_Container')
        .css({
            'display': 'block',
        })
    ;

    jQuery('#idLoading_Message')
        .text(strMessage)
    ;

    jQuery('#idLoading_Progress')
        .text('...')
    ;

    jQuery('#idLoading_Close')
        .addClass('disabled')
    ;
};

let funcFinishloading = function(strMessage) {
    jQuery('#idLoading_Message')
        .text(strMessage)
    ;

    jQuery('#idLoading_Close')
        .removeClass('disabled')
    ;
};

let funcProgress = function(strPrefix) {
    return function(objResponse) {
        jQuery('#idLoading_Progress')
            .text(strPrefix + ': ' + objResponse.strProgress)
        ;
    };
};

let funcSynclistener = function(objPort, strMessage, strLabel) { // the sync ports all report completion and progress with the same message shape
    objPort.onMessage.addListener(function(objData) {
        if (objData.strMessage === strMessage) {
            funcFinishloading((objData.objResponse === null ? 'error synchronizing ' : 'finished synchronizing ') + strLabel);

        } else if (objData.strMessage === strMessage + '-progress') {
            jQuery('#idLoading_Progress')
                .text(objData.objResponse.strProgress)
            ;

        }
    });
};

let funcBindtoggle = async function(strSelector, strKey) { // an on/off switch: flip the stored bool on click and keep the two <i> icons in sync
    let funcIcons = function(boolValue) {
        jQuery(strSelector)
            .find('i')
                .eq(0)
                    .css({
                        'display': boolValue === true ? 'none' : 'block',
                    })
                .end()
                .eq(1)
                    .css({
                        'display': boolValue === true ? 'block' : 'none',
                    })
                .end()
            .end()
        ;
    };

    jQuery(strSelector)
        .on('click', async function() {
            let boolValue = await funcStorageget(strKey) === String(false);

            await funcStorageset(strKey, boolValue);

            funcIcons(boolValue);
        })
    ;

    funcIcons(await funcStorageget(strKey) === String(true));
};

let funcWatchmarkervideos = function(objBackup, boolLegacyarray) {
    if ((boolLegacyarray === true) && (Array.isArray(objBackup) === true)) {
        return objBackup;
    }

    if (Array.isArray((objBackup || {}).objVideos) === true) {
        return objBackup.objVideos;
    }

    if (Array.isArray(((objBackup || {}).objWatchmarker || {}).objVideos) === true) {
        return objBackup.objWatchmarker.objVideos;
    }

    return null;
};

let funcWatchlistitems = function(objBackup, boolLegacyarray) {
    if ((boolLegacyarray === true) && (Array.isArray(objBackup) === true)) {
        return objBackup;
    }

    if (Array.isArray((objBackup || {}).objItems) === true) {
        return objBackup.objItems;
    }

    if (Array.isArray(((objBackup || {}).objWatchlist || {}).objItems) === true) {
        return objBackup.objWatchlist.objItems;
    }

    return null;
};

let funcImportbackup = async function(objBackup, boolDatabaselegacy, boolWatchlistlegacy) {
    const objVideos = funcWatchmarkervideos(objBackup, boolDatabaselegacy);
    const objItems = funcWatchlistitems(objBackup, boolWatchlistlegacy);

    if ((objVideos === null) && (objItems === null)) {
        return false;
    }

    if (objVideos !== null) {
        jQuery('#idLoading_Message')
            .text('importing Watchmarker')
        ;

        const objResponse = await funcPortrequest(objDatabase, 'databaseImport', {
            'objVideos': objVideos,
        }, funcProgress('Watchmarker'));

        if (objResponse === null) {
            return false;
        }
    }

    if (objItems !== null) {
        jQuery('#idLoading_Message')
            .text('importing Watchlist')
        ;

        const objResponse = await funcPortrequest(objWatchlist, 'watchlistImport', {
            'objItems': objItems,
        }, funcProgress('Watchlist'));

        if (objResponse === null) {
            return false;
        }
    }

    await funcRefreshstats();

    return true;
};

// re-render the database and watchlist sizes and the synchronization timestamps from storage - used on load and after any operation
let funcRefreshstats = async function() {
    let strSize = await funcStorageget('extensions.Youwatch.Database.intSize');

    if (strSize !== null) {
        jQuery('#idDatabase_Size').text(parseInt(strSize));
    }

    let objStorage = await chrome.storage.local.get('extensions.Youwatch.Watchlist.objItems');
    let objItems = objStorage['extensions.Youwatch.Watchlist.objItems'];

    if (Array.isArray(objItems) === false) {
        objItems = [];
    }

    jQuery('#idWatchlist_Size').text(objItems.filter(function(objItem) {
        return (objItem !== null) && (objItem !== undefined) && (typeof objItem.strIdent === 'string') && (objItem.strIdent.length === 11);
    }).length);

    let strHistory = await funcStorageget('extensions.Youwatch.History.intTimestamp');

    if (strHistory !== null) {
        jQuery('#idHistory_Timestamp').text(moment(parseInt(strHistory)).format('YYYY.MM.DD - HH:mm:ss'));
    }

    let strYoutube = await funcStorageget('extensions.Youwatch.Youtube.intTimestamp');

    if (strYoutube !== null) {
        jQuery('#idYoutube_Timestamp').text(moment(parseInt(strYoutube)).format('YYYY.MM.DD - HH:mm:ss'));
    }
};

jQuery(window.document).ready(async function() {
    jQuery('html')
        .attr({
            'data-bs-theme': window.matchMedia('(prefers-color-scheme: dark)').matches === true ? 'dark' : '',
        })
    ;

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(objEvent) {
        jQuery('html')
            .attr({
                'data-bs-theme': window.matchMedia('(prefers-color-scheme: dark)').matches === true ? 'dark' : '',
            })
        ;
    });

    jQuery('#idDatabase_Export')
        .on('click', async function() {
            funcShowloading('exporting Watchmarker + Watchlist');

            const objDatabaseResponse = await funcPortrequest(objDatabase, 'databaseExport', {}, funcProgress('Watchmarker'));

            if (objDatabaseResponse === null) {
                funcFinishloading('error exporting Watchmarker');
                return;
            }

            const objWatchlistResponse = await funcPortrequest(objWatchlist, 'watchlistExport', {}, funcProgress('Watchlist'));

            if (objWatchlistResponse === null) {
                funcFinishloading('error exporting Watchlist');
                return;
            }

            download(funcEncodebackup({
                'strType': 'watchmarker-combined',
                'intVersion': 1,
                'objWatchmarker': {
                    'objVideos': objDatabaseResponse.objVideos || [],
                },
                'objWatchlist': {
                    'objItems': objWatchlistResponse.objItems || [],
                },
            }), funcBackupname('watchmarker'), 'application/octet-stream');

            funcFinishloading('finished exporting Watchmarker + Watchlist');
        })
    ;

    jQuery('#idDatabase_Import').find('input')
        .on('change', function() {
            let objFilereader = new FileReader();
            let strFilename = '';

            objFilereader.onload = async function(objEvent) {
                funcShowloading('importing Watchmarker + Watchlist');

                try {
                    const boolWatchlist = /\.watchlist$/i.test(strFilename);

                    if (await funcImportbackup(funcDecodebackup(objEvent.target.result), boolWatchlist !== true, boolWatchlist) === true) {
                        funcFinishloading('finished importing Watchmarker + Watchlist');

                    } else {
                        funcFinishloading('error importing Watchmarker + Watchlist');
                    }
                } catch (objError) {
                    funcFinishloading('error importing Watchmarker + Watchlist');
                }
            };

            if (jQuery('#idDatabase_Import').find('input').get(0).files !== undefined) {
                if (jQuery('#idDatabase_Import').find('input').get(0).files.length === 1) {
                    const objFile = jQuery('#idDatabase_Import').find('input').get(0).files[0];
                    strFilename = objFile.name || '';
                    objFilereader.readAsText(objFile, 'utf-8');
                }
            }
        })
    ;

    jQuery('#idDatabase_Reset')
        .on('click', function() {
            jQuery(this)
                .css({
                    'display': 'none',
                })
            ;

            jQuery('#idDatabase_Resyes').closest('.input-group')
                .css({
                    'display': 'inline',
                })
            ;
        })
    ;

    jQuery('#idDatabase_Resyes')
        .on('click', async function() {
            await funcPortrequest(objDatabase, 'databaseReset', {});
            window.location.reload();
        })
    ;

    jQuery('#idWatchlist_Reset')
        .on('click', function() {
            jQuery(this)
                .css({
                    'display': 'none',
                })
            ;

            jQuery('#idWatchlist_Resyes').closest('.input-group')
                .css({
                    'display': 'inline',
                })
            ;
        })
    ;

    jQuery('#idWatchlist_Resyes')
        .on('click', async function() {
            await funcPortrequest(objWatchlist, 'watchlistReset', {});
            window.location.reload();
        })
    ;

    await funcRefreshstats();

    jQuery('#idHistory_Synchronize')
        .on('click', async function() {
            funcShowloading('synchronizing history');

            if (await funcStorageget('extensions.Youwatch.Condition.boolBrowhist') !== String(true)) {
                jQuery('#idLoading_Message')
                    .text('Firefox history sync is paused')
                ;

                jQuery('#idLoading_Progress')
                    .text('Enable it in Condition settings before running this sync.')
                ;

                jQuery('#idLoading_Close')
                    .removeClass('disabled')
                ;

                return;
            }

            objHistory.postMessage({
                'strMessage': 'historySynchronize',
                'objRequest': {
                    'intTimestamp': 0,
                },
            });
        })
    ;

    funcSynclistener(objHistory, 'historySynchronize', 'history');

    jQuery('#idYoutube_Synchronize')
        .on('click', function() {
            funcShowloading('synchronizing youtube');

            objYoutube.postMessage({
                'strMessage': 'youtubeSynchronize',
                'objRequest': {
                    'intThreshold': 1000000,
                },
            });
        })
    ;

    funcSynclistener(objYoutube, 'youtubeSynchronize', 'youtube');

    await funcBindtoggle('#idCondition_Brownav', 'extensions.Youwatch.Condition.boolBrownav');

    await funcBindtoggle('#idCondition_Browhist', 'extensions.Youwatch.Condition.boolBrowhist');

    await funcBindtoggle('#idCondition_Youprog', 'extensions.Youwatch.Condition.boolYouprog');

    await funcBindtoggle('#idCondition_Youbadge', 'extensions.Youwatch.Condition.boolYoubadge');

    await funcBindtoggle('#idCondition_Youhist', 'extensions.Youwatch.Condition.boolYouhist');

    jQuery('#idCondition_Threshold')
        .val(parseInt(await funcStorageget('extensions.Youwatch.Condition.intThreshold')) || 99)
        .on('change', async function() {
            let intThreshold = Math.max(1, Math.min(100, parseInt(jQuery(this).val()) || 99));

            jQuery(this)
                .val(intThreshold)
            ;

            await funcStorageset('extensions.Youwatch.Condition.intThreshold', intThreshold);
        })
    ;

    jQuery('#idVisualization_Theme')
        .val((await funcStorageget('extensions.Youwatch.Visualization.strTheme')) || 'bw')
        .on('change', async function() {
            // let the background re-derive the stylesheet strings from the picked theme so the marks update on the next navigation
            chrome.runtime.sendMessage({
                'strMessage': 'themeApply',
                'strTheme': jQuery(this).val(),
            });
        })
    ;

    await funcBindtoggle('#idVisualization_Fadeout', 'extensions.Youwatch.Visualization.boolFadeout');

    await funcBindtoggle('#idVisualization_Grayout', 'extensions.Youwatch.Visualization.boolGrayout');

    await funcBindtoggle('#idVisualization_Showbadge', 'extensions.Youwatch.Visualization.boolShowbadge');

    await funcBindtoggle('#idVisualization_Showwatching', 'extensions.Youwatch.Visualization.boolShowwatching');

    await funcBindtoggle('#idVisualization_Showdate', 'extensions.Youwatch.Visualization.boolShowdate');

    await funcBindtoggle('#idVisualization_Showcount', 'extensions.Youwatch.Visualization.boolShowcount');

    jQuery('#idSearch_Query')
        .on('keydown', function(objEvent) {
            if (objEvent.keyCode === 13) {
                jQuery('#idSearch_Lookup')
                    .data({
                        'intSkip' : 0,
                    })
                ;

                jQuery('#idSearch_Lookup').triggerHandler('click');
            }
        })
    ;

    jQuery('#idSearch_Lookup')
        .data({
            'intSkip' : 0,
        })
        .on('click', function(objEvent) {
            if (objEvent.originalEvent !== undefined) {
                jQuery('#idSearch_Lookup')
                    .data({
                        'intSkip' : 0,
                    })
                ;
            }

            jQuery('#idSearch_Lookup')
                .addClass('disabled')
                .find('i')
                    .eq(0)
                        .css({
                            'display': 'none',
                        })
                    .end()
                    .eq(1)
                        .css({
                            'display': 'inline',
                        })
                    .end()
                .end()
            ;

            objSearch.postMessage({
                'strMessage': 'searchLookup',
                'objRequest': {
                    'strQuery': jQuery('#idSearch_Query').val(),
                    'intSkip': jQuery('#idSearch_Lookup').data('intSkip'),
                    'intLength': 10,
                },
            });
        })
        .each(function() {
            objSearch.onMessage.addListener(function(objData) {
                if (objData.strMessage === 'searchLookup') {
                    if (objData.objResponse === null) {
                        return;
                    }

                    jQuery('#idSearch_Lookup')
                        .removeClass('disabled')
                        .find('i')
                            .eq(0)
                                .css({
                                    'display': 'inline',
                                })
                            .end()
                            .eq(1)
                                .css({
                                    'display': 'none',
                                })
                            .end()
                        .end()
                    ;

                    if (jQuery('#idSearch_Lookup').data('intSkip') === 0) {
                        jQuery('#idSearch_Results')
                            .empty()
                            .css({
                                'display': 'flex',
                                'flex-direction': 'column',
                                'gap': '16px',
                            })
                        ;
                    }

                    for (let objVideo of objData.objResponse.objVideos) {
                        jQuery('#idSearch_Results')
                            .append(jQuery('<div></div>')
                                .css({
                                    'border': '1px solid var(--bs-border-color)',
                                    'border-radius': 'var(--bs-border-radius)',
                                    'display': 'flex',
                                    'gap': '12px',
                                    'padding': '12px',
                                })
                                .append(jQuery('<div></div>')
                                    .append(jQuery('<a></a>')
                                        .attr({
                                            'href': 'https://www.youtube.com/watch?v=' + objVideo.strIdent,
                                            'target': '_blank',
                                        })
                                        .append(jQuery('<img></img>')
                                            .attr({
                                                'src': 'https://img.youtube.com/vi/' + objVideo.strIdent + '/mqdefault.jpg',
                                            })
                                            .css({
                                                'border-radius': 'var(--bs-border-radius)',
                                                'height': '94px',
                                                'width': '168px',
                                            })
                                        )
                                    )
                                )
                                .append(jQuery('<div></div>')
                                    .css({
                                        'flex': '1',
                                    })
                                    .append(jQuery('<div></div>')
                                        .append(jQuery('<a></a>')
                                            .attr({
                                                'href': 'https://www.youtube.com/watch?v=' + objVideo.strIdent,
                                                'target': '_blank',
                                            })
                                            .css({
                                                'color': 'inherit',
                                                'font-size': '16px',
                                                'text-decoration': 'none',
                                            })
                                            .text(objVideo.strTitle)
                                        )
                                    )
                                    .append(jQuery('<div></div>')
                                        .css({
                                            'color': 'var(--bs-secondary-color)',
                                            'font-size': '13px',
                                            'margin': '5px 0px 0px 0px',
                                        })
                                        .text(moment(objVideo.intTimestamp).format('YYYY.MM.DD - HH:mm'))
                                    )
                                    .append(jQuery('<div></div>')
                                        .css({
                                            'color': 'var(--bs-secondary-color)',
                                            'font-size': '13px',
                                            'margin': '5px 0px 0px 0px',
                                        })
                                        .text((objVideo.intCount || 0) + ' completed view' + ((objVideo.intCount || 0) == 1 ? '' : 's'))
                                    )
                                    .append(jQuery('<div></div>')
                                        .addClass('youwatch-statebadge')
                                        .css({
                                            'display': 'inline-block',
                                            'background-color': (objVideo.strState || 'watching') === 'watched' ? '#000000' : '#065fd4',
                                            'border-radius': '2px',
                                            'color': '#FFFFFF',
                                            'font-size': '11px',
                                            'margin': '7px 0px 0px 0px',
                                            'padding': '3px 6px 3px 6px',
                                        })
                                        .text((objVideo.strState || 'watching') === 'watched' ? 'WATCHED' : ('WATCHING' + ((objVideo.intPercent > 0) ? (' ' + objVideo.intPercent + '%') : '')))
                                    )
                                )
                                .append(jQuery('<div></div>')
                                    .css({
                                        'display': 'flex',
                                        'gap': '12px',
                                        'align-items': 'flex-start',
                                    })
                                    .append(jQuery('<div></div>')
                                        .css({
                                            'cursor': 'pointer',
                                            // only offer "mark as watched" for entries that are not already watched
                                            'display': (objVideo.strState || 'watching') === 'watched' ? 'none' : 'block',
                                        })
                                        .attr({
                                            'title': 'Mark as watched',
                                        })
                                        .append(jQuery('<i></i>')
                                            .addClass('fa-regular')
                                            .addClass('fa-circle-check')
                                        )
                                        .data({
                                            'strIdent': objVideo.strIdent,
                                            'strTitle': objVideo.strTitle,
                                        })
                                        .on('click', function() {
                                            let objButton = jQuery(this);

                                            chrome.runtime.sendMessage({
                                                'strMessage': 'youtubeMark',
                                                'strIdent': objButton.data('strIdent'),
                                                'strTitle': objButton.data('strTitle'),
                                                'strState': 'watched',
                                                'boolConfirmed': true, // a manual mark is authoritative and should not be demoted later
                                            }, function(objResponse) {
                                                if ((objResponse === null) || (objResponse === undefined)) {
                                                    return;
                                                }

                                                objButton
                                                    .css({
                                                        'display': 'none', // it is watched now, so the action no longer applies
                                                    })
                                                ;

                                                objButton.parent().parent()
                                                    .find('.youwatch-statebadge')
                                                        .css({
                                                            'background-color': '#000000',
                                                        })
                                                        .text('WATCHED')
                                                ;
                                            });
                                        })
                                    )
                                    .append(jQuery('<div></div>')
                                        .css({
                                            'cursor': 'pointer',
                                        })
                                        .attr({
                                            'title': 'Delete',
                                        })
                                        .append(jQuery('<i></i>')
                                            .addClass('fa-regular')
                                            .addClass('fa-trash-can')
                                        )
                                        .data({
                                            'strIdent': objVideo.strIdent,
                                        })
                                        .on('click', function() {
                                            funcShowloading('deleting video');

                                            objSearch.postMessage({
                                                'strMessage': 'searchDelete',
                                                'objRequest': {
                                                    'strIdent': jQuery(this).data('strIdent'),
                                                },
                                            });
                                        })
                                    )
                                )
                            )
                        ;
                    }

                    if (objData.objResponse.objVideos.length === 10) {
                        jQuery('#idSearch_Results').children().eq(-1)
                            .each(function() {
                                new IntersectionObserver(function(objEntries, objObserver) {
                                    if (objEntries[0].isIntersecting === true) {
                                        objObserver.unobserve(objEntries[0].target);

                                        jQuery('#idSearch_Lookup')
                                            .data({
                                                'intSkip' : jQuery('#idSearch_Lookup').data('intSkip') + 10,
                                            })
                                        ;

                                        jQuery('#idSearch_Lookup').triggerHandler('click');
                                    }
                                }).observe(this)
                            })
                        ;
                    }

                } else if (objData.strMessage === 'searchDelete') {
                    if (objData.objResponse === null) {
                        jQuery('#idLoading_Message')
                            .text('error deleting video')
                        ;

                    } else {
                        jQuery('#idLoading_Message')
                            .text('finished deleting video')
                        ;

                    }

                    jQuery('#idLoading_Close')
                        .removeClass('disabled')
                    ;

                } else if (objData.strMessage === 'searchDelete-progress') {
                    jQuery('#idLoading_Progress')
                        .text(objData.objResponse.strProgress)
                    ;

                }
            });
        })
        .each(function() {
            jQuery(this).triggerHandler('click');
        })
    ;

    jQuery('#idLoading_Close')
        .on('click', async function() {
            // hide the modal and refresh the stats in place instead of reloading the page (which would lose the scroll position)
            jQuery('#idLoading_Container')
                .css({
                    'display': 'none',
                })
            ;

            await funcRefreshstats();

            // re-run the search from the top so the results reflect imports, synchronizations and deletions
            jQuery('#idSearch_Lookup')
                .data({
                    'intSkip': 0,
                })
            ;

            jQuery('#idSearch_Lookup').triggerHandler('click');

            jQuery('#idLoading_Close')
                .removeClass('disabled')
            ;
        })
    ;

    // let Enter dismiss the modal via its Close button (while it is open and the operation has finished); the capture
    // phase keeps this from also triggering the search box's own Enter handler underneath the overlay
    window.document.addEventListener('keydown', function(objEvent) {
        if (objEvent.keyCode !== 13) {
            return;
        }

        if (jQuery('#idLoading_Container').css('display') === 'none') {
            return;
        }

        if (jQuery('#idLoading_Close').hasClass('disabled') === true) {
            return; // the operation is still running, so closing is not allowed yet
        }

        objEvent.preventDefault();
        objEvent.stopPropagation();

        jQuery('#idLoading_Close').triggerHandler('click');
    }, true);
});
