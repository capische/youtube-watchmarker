'use strict';

let objDatabase = chrome.runtime.connect({
    'name': 'database',
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

// re-render the database size and the synchronization timestamps from storage - used on load and after any operation
let funcRefreshstats = async function() {
    let strSize = await funcStorageget('extensions.Youwatch.Database.intSize');

    if (strSize !== null) {
        jQuery('#idDatabase_Size').text(parseInt(strSize));
    }

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
        .on('click', function() {
            jQuery('#idLoading_Container')
                .css({
                    'display': 'block',
                })
            ;

            jQuery('#idLoading_Message')
                .text('exporting database')
            ;

            jQuery('#idLoading_Progress')
                .text('...')
            ;

            jQuery('#idLoading_Close')
                .addClass('disabled')
            ;

            objDatabase.postMessage({
                'strMessage': 'databaseExport',
                'objRequest': {},
            });
        })
        .each(function() {
            objDatabase.onMessage.addListener(function(objData) {
                if (objData.strMessage === 'databaseExport') {
                    if (objData.objResponse === null) {
                        jQuery('#idLoading_Message')
                            .text('error exporting database')
                        ;

                    } else if (objData.objResponse !== null) {
                        jQuery('#idLoading_Message')
                            .text('finished exporting database')
                        ;

                        download(btoa(unescape(encodeURIComponent(JSON.stringify(objData.objResponse.objVideos)))), new Date().getFullYear() + '.' + ('0' + (new Date().getMonth() + 1)).slice(-2) + '.' + ('0' + new Date().getDate()).slice(-2) + '.database', 'application/octet-stream');
                    }

                    jQuery('#idLoading_Close')
                        .removeClass('disabled')
                    ;

                } else if (objData.strMessage === 'databaseExport-progress') {
                    jQuery('#idLoading_Progress')
                        .text(objData.objResponse.strProgress)
                    ;

                }
            });
        })
    ;

    jQuery('#idDatabase_Import').find('input')
        .on('change', function() {
            jQuery('#idLoading_Container')
                .css({
                    'display': 'block',
                })
            ;

            jQuery('#idLoading_Message')
                .text('importing database')
            ;

            jQuery('#idLoading_Progress')
                .text('...')
            ;

            jQuery('#idLoading_Close')
                .addClass('disabled')
            ;

            let objFilereader = new FileReader();

            objFilereader.onload = function(objEvent) {
                objDatabase.postMessage({
                    'strMessage': 'databaseImport',
                    'objRequest': {
                        'objVideos': JSON.parse(decodeURIComponent(escape(atob(objEvent.target.result)))),
                    },
                });
            };

            if (jQuery('#idDatabase_Import').find('input').get(0).files !== undefined) {
                if (jQuery('#idDatabase_Import').find('input').get(0).files.length === 1) {
                    objFilereader.readAsText(jQuery('#idDatabase_Import').find('input').get(0).files[0], 'utf-8');
                }
            }
        })
        .each(function() {
            objDatabase.onMessage.addListener(function(objData) {
                if (objData.strMessage === 'databaseImport') {
                    if (objData.objResponse === null) {
                        jQuery('#idLoading_Message')
                            .text('error importing database')
                        ;

                    } else if (objData.objResponse !== null) {
                        jQuery('#idLoading_Message')
                            .text('finished importing database')
                        ;

                    }

                    jQuery('#idLoading_Close')
                        .removeClass('disabled')
                    ;

                } else if (objData.strMessage === 'databaseImport-progress') {
                    jQuery('#idLoading_Progress')
                        .text(objData.objResponse.strProgress)
                    ;

                }
            });
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
        .on('click', function() {
            objDatabase.postMessage({
                'strMessage': 'databaseReset',
                'objRequest': {},
            });
        })
        .each(function() {
            objDatabase.onMessage.addListener(function(objData) {
                if (objData.strMessage === 'databaseReset') {
                    window.location.reload();
                }
            });
        })
    ;

    await funcRefreshstats();

    jQuery('#idHistory_Synchronize')
        .on('click', function() {
            jQuery('#idLoading_Container')
                .css({
                    'display': 'block',
                })
            ;

            jQuery('#idLoading_Message')
                .text('synchronizing history')
            ;

            jQuery('#idLoading_Progress')
                .text('...')
            ;

            jQuery('#idLoading_Close')
                .addClass('disabled')
            ;

            objHistory.postMessage({
                'strMessage': 'historySynchronize',
                'objRequest': {
                    'intTimestamp': 0,
                },
            });
        })
        .each(function() {
            objHistory.onMessage.addListener(function(objData) {
                if (objData.strMessage === 'historySynchronize') {
                    if (objData.objResponse === null) {
                        jQuery('#idLoading_Message')
                            .text('error synchronizing history')
                        ;

                    } else if (objData.objResponse !== null) {
                        jQuery('#idLoading_Message')
                            .text('finished synchronizing history')
                        ;

                    }

                    jQuery('#idLoading_Close')
                        .removeClass('disabled')
                    ;

                } else if (objData.strMessage === 'historySynchronize-progress') {
                    jQuery('#idLoading_Progress')
                        .text(objData.objResponse.strProgress)
                    ;

                }
            });
        })
    ;

    jQuery('#idYoutube_Synchronize')
        .on('click', function() {
            jQuery('#idLoading_Container')
                .css({
                    'display': 'block',
                })
            ;

            jQuery('#idLoading_Message')
                .text('synchronizing youtube')
            ;

            jQuery('#idLoading_Progress')
                .text('...')
            ;

            jQuery('#idLoading_Close')
                .addClass('disabled')
            ;

            objYoutube.postMessage({
                'strMessage': 'youtubeSynchronize',
                'objRequest': {
                    'intThreshold': 1000000,
                },
            });
        })
        .each(function() {
            objYoutube.onMessage.addListener(function(objData) {
                if (objData.strMessage === 'youtubeSynchronize') {
                    if (objData.objResponse === null) {
                        jQuery('#idLoading_Message')
                            .text('error synchronizing youtube')
                        ;

                    } else if (objData.objResponse !== null) {
                        jQuery('#idLoading_Message')
                            .text('finished synchronizing youtube')
                        ;

                    }

                    jQuery('#idLoading_Close')
                        .removeClass('disabled')
                    ;

                } else if (objData.strMessage === 'youtubeSynchronize-progress') {
                    jQuery('#idLoading_Progress')
                        .text(objData.objResponse.strProgress)
                    ;

                }
            });
        })
    ;

    jQuery('#idCondition_Brownav')
        .on('click', async function() {
            await funcStorageset('extensions.Youwatch.Condition.boolBrownav', await funcStorageget('extensions.Youwatch.Condition.boolBrownav') === String(false));

            jQuery(this)
                .find('i')
                    .eq(0)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Condition.boolBrownav') === String(true) ? 'none' : 'block',
                        })
                    .end()
                    .eq(1)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Condition.boolBrownav') === String(true) ? 'block' : 'none',
                        })
                    .end()
                .end()
            ;
        })
        .find('i')
            .eq(0)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Condition.boolBrownav') === String(true) ? 'none' : 'block',
                })
            .end()
            .eq(1)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Condition.boolBrownav') === String(true) ? 'block' : 'none',
                })
            .end()
        .end()
    ;

    jQuery('#idCondition_Browhist')
        .on('click', async function() {
            await funcStorageset('extensions.Youwatch.Condition.boolBrowhist', await funcStorageget('extensions.Youwatch.Condition.boolBrowhist') === String(false));

            jQuery(this)
                .find('i')
                    .eq(0)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Condition.boolBrowhist') === String(true) ? 'none' : 'block',
                        })
                    .end()
                    .eq(1)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Condition.boolBrowhist') === String(true) ? 'block' : 'none',
                        })
                    .end()
                .end()
            ;
        })
        .find('i')
            .eq(0)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Condition.boolBrowhist') === String(true) ? 'none' : 'block',
                })
            .end()
            .eq(1)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Condition.boolBrowhist') === String(true) ? 'block' : 'none',
                })
            .end()
        .end()
    ;

    jQuery('#idCondition_Youprog')
        .on('click', async function() {
            await funcStorageset('extensions.Youwatch.Condition.boolYouprog', await funcStorageget('extensions.Youwatch.Condition.boolYouprog') === String(false));

            jQuery(this)
                .find('i')
                    .eq(0)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Condition.boolYouprog') === String(true) ? 'none' : 'block',
                        })
                    .end()
                    .eq(1)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Condition.boolYouprog') === String(true) ? 'block' : 'none',
                        })
                    .end()
                .end()
            ;
        })
        .find('i')
            .eq(0)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Condition.boolYouprog') === String(true) ? 'none' : 'block',
                })
            .end()
            .eq(1)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Condition.boolYouprog') === String(true) ? 'block' : 'none',
                })
            .end()
        .end()
    ;

    jQuery('#idCondition_Youbadge')
        .on('click', async function() {
            await funcStorageset('extensions.Youwatch.Condition.boolYoubadge', await funcStorageget('extensions.Youwatch.Condition.boolYoubadge') === String(false));

            jQuery(this)
                .find('i')
                    .eq(0)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Condition.boolYoubadge') === String(true) ? 'none' : 'block',
                        })
                    .end()
                    .eq(1)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Condition.boolYoubadge') === String(true) ? 'block' : 'none',
                        })
                    .end()
                .end()
            ;
        })
        .find('i')
            .eq(0)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Condition.boolYoubadge') === String(true) ? 'none' : 'block',
                })
            .end()
            .eq(1)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Condition.boolYoubadge') === String(true) ? 'block' : 'none',
                })
            .end()
        .end()
    ;

    jQuery('#idCondition_Youhist')
        .on('click', async function() {
            await funcStorageset('extensions.Youwatch.Condition.boolYouhist', await funcStorageget('extensions.Youwatch.Condition.boolYouhist') === String(false));

            jQuery(this)
                .find('i')
                    .eq(0)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Condition.boolYouhist') === String(true) ? 'none' : 'block',
                        })
                    .end()
                    .eq(1)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Condition.boolYouhist') === String(true) ? 'block' : 'none',
                        })
                    .end()
                .end()
            ;
        })
        .find('i')
            .eq(0)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Condition.boolYouhist') === String(true) ? 'none' : 'block',
                })
            .end()
            .eq(1)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Condition.boolYouhist') === String(true) ? 'block' : 'none',
                })
            .end()
        .end()
    ;

    jQuery('#idCondition_Threshold')
        .val(parseInt(await funcStorageget('extensions.Youwatch.Condition.intThreshold')) || 95)
        .on('change', async function() {
            let intThreshold = Math.max(1, Math.min(100, parseInt(jQuery(this).val()) || 95));

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

    jQuery('#idVisualization_Fadeout')
        .on('click', async function() {
            await funcStorageset('extensions.Youwatch.Visualization.boolFadeout', await funcStorageget('extensions.Youwatch.Visualization.boolFadeout') === String(false));

            jQuery(this)
                .find('i')
                    .eq(0)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Visualization.boolFadeout') === String(true) ? 'none' : 'block',
                        })
                    .end()
                    .eq(1)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Visualization.boolFadeout') === String(true) ? 'block' : 'none',
                        })
                    .end()
                .end()
            ;
        })
        .find('i')
            .eq(0)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Visualization.boolFadeout') === String(true) ? 'none' : 'block',
                })
            .end()
            .eq(1)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Visualization.boolFadeout') === String(true) ? 'block' : 'none',
                })
            .end()
        .end()
    ;

    jQuery('#idVisualization_Grayout')
        .on('click', async function() {
            await funcStorageset('extensions.Youwatch.Visualization.boolGrayout', await funcStorageget('extensions.Youwatch.Visualization.boolGrayout') === String(false));

            jQuery(this)
                .find('i')
                    .eq(0)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Visualization.boolGrayout') === String(true) ? 'none' : 'block',
                        })
                    .end()
                    .eq(1)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Visualization.boolGrayout') === String(true) ? 'block' : 'none',
                        })
                    .end()
                .end()
            ;
        })
        .find('i')
            .eq(0)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Visualization.boolGrayout') === String(true) ? 'none' : 'block',
                })
            .end()
            .eq(1)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Visualization.boolGrayout') === String(true) ? 'block' : 'none',
                })
            .end()
        .end()
    ;

    jQuery('#idVisualization_Showbadge')
        .on('click', async function() {
            await funcStorageset('extensions.Youwatch.Visualization.boolShowbadge', await funcStorageget('extensions.Youwatch.Visualization.boolShowbadge') === String(false));

            jQuery(this)
                .find('i')
                    .eq(0)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Visualization.boolShowbadge') === String(true) ? 'none' : 'block',
                        })
                    .end()
                    .eq(1)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Visualization.boolShowbadge') === String(true) ? 'block' : 'none',
                        })
                    .end()
                .end()
            ;
        })
        .find('i')
            .eq(0)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Visualization.boolShowbadge') === String(true) ? 'none' : 'block',
                })
            .end()
            .eq(1)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Visualization.boolShowbadge') === String(true) ? 'block' : 'none',
                })
            .end()
        .end()
    ;

    jQuery('#idVisualization_Showwatching')
        .on('click', async function() {
            await funcStorageset('extensions.Youwatch.Visualization.boolShowwatching', await funcStorageget('extensions.Youwatch.Visualization.boolShowwatching') === String(false));

            jQuery(this)
                .find('i')
                    .eq(0)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Visualization.boolShowwatching') === String(true) ? 'none' : 'block',
                        })
                    .end()
                    .eq(1)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Visualization.boolShowwatching') === String(true) ? 'block' : 'none',
                        })
                    .end()
                .end()
            ;
        })
        .find('i')
            .eq(0)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Visualization.boolShowwatching') === String(true) ? 'none' : 'block',
                })
            .end()
            .eq(1)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Visualization.boolShowwatching') === String(true) ? 'block' : 'none',
                })
            .end()
        .end()
    ;

    jQuery('#idVisualization_Showdate')
        .on('click', async function() {
            await funcStorageset('extensions.Youwatch.Visualization.boolShowdate', await funcStorageget('extensions.Youwatch.Visualization.boolShowdate') === String(false));

            jQuery(this)
                .find('i')
                    .eq(0)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Visualization.boolShowdate') === String(true) ? 'none' : 'block',
                        })
                    .end()
                    .eq(1)
                        .css({
                            'display': await funcStorageget('extensions.Youwatch.Visualization.boolShowdate') === String(true) ? 'block' : 'none',
                        })
                    .end()
                .end()
            ;
        })
        .find('i')
            .eq(0)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Visualization.boolShowdate') === String(true) ? 'none' : 'block',
                })
            .end()
            .eq(1)
                .css({
                    'display': await funcStorageget('extensions.Youwatch.Visualization.boolShowdate') === String(true) ? 'block' : 'none',
                })
            .end()
        .end()
    ;

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
                                            'background-color': (objVideo.strState || 'watched') === 'watched' ? '#000000' : '#065fd4',
                                            'border-radius': '2px',
                                            'color': '#FFFFFF',
                                            'font-size': '11px',
                                            'margin': '7px 0px 0px 0px',
                                            'padding': '3px 6px 3px 6px',
                                        })
                                        .text((objVideo.strState || 'watched') === 'watched' ? 'WATCHED' : ('WATCHING' + ((objVideo.intPercent > 0) ? (' ' + objVideo.intPercent + '%') : '')))
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
                                            'display': (objVideo.strState || 'watched') === 'watched' ? 'none' : 'block',
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
                                            jQuery('#idLoading_Container')
                                                .css({
                                                    'display': 'block',
                                                })
                                            ;

                                            jQuery('#idLoading_Message')
                                                .text('deleting video')
                                            ;

                                            jQuery('#idLoading_Progress')
                                                .text('...')
                                            ;

                                            jQuery('#idLoading_Close')
                                                .addClass('disabled')
                                            ;

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

                    } else if (objData.objResponse !== null) {
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
