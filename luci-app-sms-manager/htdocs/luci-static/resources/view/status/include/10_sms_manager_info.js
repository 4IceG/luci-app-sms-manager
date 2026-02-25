'use strict';
'require baseclass';
'require dom';
'require fs';
'require uci';
'require poll';
'require ui';

/*
	Copyright 2026 Rafał Wabik - IceG - From eko.one.pl forum

	Licensed to the GNU General Public License v3.0.
*/

return baseclass.extend({
	title: _('Modems'),

	checkInterval: 12, // 12 × 5s = 60s

	restoreAlignmentSettings: function() {
		let alignment = localStorage.getItem('luci-smsmgr-tiles-alignment');
		if (alignment === 'left' || alignment === 'center' || alignment === 'right') {
			return alignment;
		}
		return 'left';
	},

	saveAlignmentSettings: function(alignment) {
		localStorage.setItem('luci-smsmgr-tiles-alignment', alignment);
	},

	getAlignmentStyle: function(alignment) {
		switch (alignment) {
			case 'center': return 'justify-content:center;';
			case 'right':  return 'justify-content:flex-end;';
			default:       return 'justify-content:flex-start;';
		}
	},

	showAlignmentModal: function(container) {
		let currentAlignment = this.restoreAlignmentSettings();

		let modalContent = E('div', {}, [
			E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:1em;' }, [
				E('div', { 'class': 'cbi-section-node' }, [
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Align preview to:')),
						E('div', { 'class': 'cbi-value-field' }, [
							E('div', { 'style': 'display:flex;flex-direction:row;gap:20px;align-items:center;' }, [
								E('label', { 'style': 'display:flex;align-items:center;cursor:pointer;' }, [
									E('input', { 'type': 'radio', 'name': 'smsmgr-tile-alignment', 'value': 'left',   'id': 'smsmgr-align-left',   'style': 'margin-right:6px;' }),
									E('span', {}, _('Left'))
								]),
								E('label', { 'style': 'display:flex;align-items:center;cursor:pointer;' }, [
									E('input', { 'type': 'radio', 'name': 'smsmgr-tile-alignment', 'value': 'center', 'id': 'smsmgr-align-center', 'style': 'margin-right:6px;' }),
									E('span', {}, _('Center'))
								]),
								E('label', { 'style': 'display:flex;align-items:center;cursor:pointer;' }, [
									E('input', { 'type': 'radio', 'name': 'smsmgr-tile-alignment', 'value': 'right',  'id': 'smsmgr-align-right',  'style': 'margin-right:6px;' }),
									E('span', {}, _('Right'))
								])
							])
						])
					])
				])
			])
		]);

		ui.showModal(_('New message information block settings'), [
			modalContent,
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'cbi-button cbi-button-neutral',
					'click': L.bind(function() { ui.hideModal(); }, this)
				}, _('Cancel')),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-positive',
					'click': L.bind(function() {
						let sel = document.querySelector('input[name="smsmgr-tile-alignment"]:checked');
						if (!sel) return;
						let selectedAlignment = sel.value;
						this.saveAlignmentSettings(selectedAlignment);
						container.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;' + this.getAlignmentStyle(selectedAlignment);
						ui.hideModal();
						ui.addTimeLimitedNotification(null, E('p', _('Alignment settings saved successfully')), 5000, 'info');
					}, this)
				}, _('Save'))
			])
		]);

		requestAnimationFrame(function() {
			let radio = document.getElementById('smsmgr-align-' + currentAlignment);
			if (radio) radio.checked = true;
		});
	},

	addStyles: function() {
		if (document.getElementById('smsmgr-sms-styles')) return;

		const style = document.createElement('style');
		style.id = 'smsmgr-sms-styles';
		style.type = 'text/css';
		style.textContent = `
			:root {
				--smsmgr-badge-bg:   #34c759;
				--smsmgr-badge-text: #ffffff;
			}
			:root[data-darkmode="true"] {
				--smsmgr-badge-bg:   rgba(46, 204, 113, 0.66);
				--smsmgr-badge-text: #e5e7eb;
			}
			.smsmgr-sms-badge {
				position: absolute;
				top: -6px;
				right: -8px;
				background-color: var(--smsmgr-badge-bg);
				color: var(--smsmgr-badge-text);
				text-shadow: 0 1px 2px rgba(0,0,0,.4), 0 2px 6px rgba(0,0,0,.25);
				padding: 2px 5px;
				border-radius: 4px;
				min-width: 18px;
				text-align: center;
				white-space: nowrap;
				font-weight: 500;
				font-size: 11px;
				display: inline-block;
				border: 1px solid transparent;
				line-height: 1.3;
			}
			:root[data-darkmode="true"] .smsmgr-sms-badge {
				border: 1px solid rgba(46, 204, 113, 0.6);
			}
			.smsmgr-icon-no-messages img  { opacity: 0.7; }
			.smsmgr-icon-with-messages img { opacity: 1; }
			:root[data-darkmode="true"] .smsmgr-icon-no-messages img,
			:root[data-darkmode="true"] .smsmgr-icon-with-messages img { opacity: 0.5; }
			.smsmgr-info-box .ifacebox-head,
			.smsmgr-info-box .ifacebox-body {
				user-select: none;
				-webkit-user-select: none;
				-moz-user-select: none;
				-ms-user-select: none;
				cursor: default;
			}
			.smsmgr-name-truncate {
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
				max-width: 100%;
				display: block;
			}
		`;
		document.head.appendChild(style);
	},

	getSmsCountViaMmcli: function(devPath) {
		if (!devPath) return Promise.resolve(0);
		let mmPathMatch = devPath.match(/\/Modem\/(\d+)$/);
		if (mmPathMatch) {
			let modemNum = mmPathMatch[1];
			return L.resolveDefault(
				fs.exec('/usr/bin/mmcli', ['-m', modemNum, '--messaging-list-sms']),
				null
			).then(function(res) {
				if (!res || res.code !== 0) return 0;
				let output = res.stdout || '';
				let matches = output.match(/\/SMS\//g);
				return matches ? matches.length : 0;
			});
		}

		return L.resolveDefault(
			fs.exec('/usr/bin/mmcli', ['-L']),
			null
		).then(function(res) {
			if (!res || res.code !== 0) return 0;
			let output = res.stdout || '';
			let modems = [];
			let re = /\/org\/freedesktop\/ModemManager1\/Modem\/(\d+)/g;
			let m;
			while ((m = re.exec(output)) !== null) {
				modems.push(m[1]);
			}
			if (modems.length === 0) return 0;

			return Promise.all(modems.map(function(num) {
				return L.resolveDefault(
					fs.exec('/usr/bin/mmcli', ['-m', num]),
					null
				).then(function(r) {
					if (!r || r.code !== 0) return 0;
					if (r.stdout && r.stdout.indexOf(devPath) >= 0) {
						return L.resolveDefault(
							fs.exec('/usr/bin/mmcli', ['-m', num, '--messaging-list-sms']),
							null
						).then(function(sr) {
							if (!sr || sr.code !== 0) return 0;
							let matches = (sr.stdout || '').match(/\/SMS\//g);
							return matches ? matches.length : 0;
						});
					}
					return 0;
				});
			})).then(function(counts) {
				return counts.reduce(function(a, b) { return a + b; }, 0);
			});
		});
	},

	getModemDataMm: function(comm_port, forced_plmn_op) {
		if (!comm_port) return Promise.resolve(null);

		return L.resolveDefault(
			fs.exec_direct('/usr/bin/md_modemmanager', [comm_port, '', forced_plmn_op || '0']),
			null
		).then(function(res) {
			if (!res) return null;
			try {
				let jsonraw = JSON.parse(res.replace(/[\u0000-\u001F\u007F-\u009F]/g, ''));
				let json = Object.values(jsonraw);
				if (!json || json.length < 3 || !json[2]) return null;

				let signalQuality = 0;

				if (json[2].signal != null && String(json[2].signal).trim() !== '') {
					signalQuality = parseInt(json[2].signal) || 0;
				} else if (json[2].csq_per != null && String(json[2].csq_per).trim() !== '') {
					signalQuality = parseInt(json[2].csq_per) || 0;
				} else if (json[2].csq != null && String(json[2].csq).trim() !== '') {
					let csq = parseInt(json[2].csq);
					if (!isNaN(csq) && csq >= 0 && csq !== 99)
						signalQuality = Math.min(Math.round((csq / 31) * 100), 100);
				}

				return {
					operator:      json[2].operator_name || '-',
					mode:          json[2].mode          || '-',
					signalQuality: signalQuality
				};
			} catch (e) {
				return null;
			}
		});
	},
	
	getSignalIcon: function(quality) {
		let icon;
		if (quality <= 0)
			icon = L.resource('icons/mobile-signal-000-000.svg');
		else if (quality < 20)
			icon = L.resource('icons/mobile-signal-000-020.svg');
		else if (quality < 40)
			icon = L.resource('icons/mobile-signal-020-040.svg');
		else if (quality < 60)
			icon = L.resource('icons/mobile-signal-040-060.svg');
		else if (quality < 80)
			icon = L.resource('icons/mobile-signal-060-080.svg');
		else
			icon = L.resource('icons/mobile-signal-080-100.svg');
		return icon;
	},

	formatMode: function(modeRaw) {
		if (!modeRaw || modeRaw.length <= 1 || modeRaw === '-') return '-';

		let modeUp = modeRaw.toUpperCase();
		let modeDisplay;

		if (modeUp.indexOf('LTE') >= 0 || modeUp.indexOf('5G') >= 0) {
			let parts = modeRaw.split(' ');
			let tech = parts[0];
			if (modeUp.indexOf('5G') >= 0 && parts[1]) tech += ' ' + parts[1];
			let count = (modeRaw.match(/\//g) || []).length + 1;
			modeDisplay = (count > 1) ? (tech + ' (' + count + 'CA)') : tech;
		} else {
			modeDisplay = modeRaw.split(' ')[0];
		}

		return modeDisplay.replace('LTE_A', 'LTE-A');
	},

	renderModemBadge: function(modemData, hasFullData, onHeaderClick) {
		let operator      = modemData.operator      || '-';
		let technology    = this.formatMode(modemData.mode);
		let modemName     = modemData.modemName     || 'Modem';
		let smsCount      = modemData.smsCount      || 0;
		let signalQuality = modemData.signalQuality  || 0;

		let truncatedName = (modemName.length > 25)
			? modemName.substring(0, 22) + '...'
			: modemName;

		let signalIcon = this.getSignalIcon(signalQuality);
		let smsIconUrl = L.resource('icons/newdelsms.png');

		if (!hasFullData) {
			return E('div', {
				'class': 'ifacebox smsmgr-info-box',
				'style': 'margin:0.2em;flex:1;min-width:80px;max-width:100px;'
			}, [
				E('div', {
					'class': 'ifacebox-head port-label',
					'style': 'padding:4px 6px;font-weight:normal;font-size:13px;cursor:pointer;',
					'click': onHeaderClick
				}, [
					E('span', { 'class': 'smsmgr-name-truncate' }, _('SMS Info'))
				]),
				E('div', {
					'class': 'ifacebox-body',
					'style': 'padding:8px;text-align:center;display:block;'
				}, [
					E('span', {
						'title': smsCount > 0
							? '%s: %d'.format(_('New SMS'), smsCount)
							: _('No new SMS'),
						'style': 'position:relative;display:inline-block;',
						'class': smsCount > 0 ? 'smsmgr-icon-with-messages' : 'smsmgr-icon-no-messages'
					}, [
						E('img', { 'src': smsIconUrl, 'style': 'width:28px;height:28px;' }),
						smsCount > 0
							? E('span', { 'class': 'smsmgr-sms-badge' }, String(smsCount))
							: ''
					])
				])
			]);
		}

		return E('div', {
			'class': 'ifacebox smsmgr-info-box',
			'style': 'margin:0.2em;flex:1;min-width:160px;max-width:220px;'
		}, [
			E('div', {
				'class': 'ifacebox-head port-label',
				'style': 'padding:4px 6px;font-weight:normal;font-size:13px;cursor:pointer;',
				'click': onHeaderClick
			}, [
				E('span', {
					'class': 'smsmgr-name-truncate',
					'title': modemName
				}, truncatedName)
			]),
			E('div', {
				'class': 'ifacebox-body',
				'style': 'padding:4px 6px;display:block;'
			}, [
				E('table', {
					'style': 'width:100%;border:none;border-collapse:collapse;table-layout:fixed;margin:0;'
				}, [
					E('tr', {}, [
						E('td', {
							'style': 'width:66%;border:none;padding:2px;vertical-align:middle;text-align:center;'
						}, [
							E('span', {
								'title': '%s: %d%%'.format(_('Signal Quality'), signalQuality),
								'style': 'display:inline-block;'
							}, [
								E('img', {
									'src': signalIcon,
									'style': 'width:28px;height:28px;vertical-align:middle;'
								}),
								E('span', { 'style': 'vertical-align:middle;font-size:12px;' }, [
									' ',
									operator,
									E('br'),
									E('small', { 'style': 'font-size:10px;' }, technology)
								])
							])
						]),
						E('td', {
							'style': 'width:34%;border:none;border-left:1px solid var(--border-color-medium);padding:2px;text-align:center;vertical-align:middle;'
						}, [
							E('span', {
								'title': smsCount > 0
									? '%s: %d'.format(_('New SMS'), smsCount)
									: _('No new SMS'),
								'style': 'position:relative;display:inline-block;',
								'class': smsCount > 0 ? 'smsmgr-icon-with-messages' : 'smsmgr-icon-no-messages'
							}, [
								E('img', { 'src': smsIconUrl, 'style': 'width:28px;height:28px;' }),
								smsCount > 0
									? E('span', { 'class': 'smsmgr-sms-badge' }, String(smsCount))
									: ''
							])
						])
					])
				])
			])
		]);
	},

	load: function() {
		return Promise.all([
			L.resolveDefault(uci.load('sms_manager')),
			L.resolveDefault(uci.load('defmodems'))
		]).then(L.bind(function() {

			let onTopSms = uci.get('sms_manager', '@sms_manager[0]', 'ontopsms');
			if (onTopSms !== '1') return null;

			window.smsmgrCounter = ('smsmgrCounter' in window)
				? ++window.smsmgrCounter : 0;

			if (!('smsmgrData' in window)) window.smsmgrData = null;

			if (window.smsmgrData !== null &&
			    window.smsmgrCounter % this.checkInterval !== 0) {
				return window.smsmgrData;
			}

			window.smsmgrCache = {};

			let readport  = uci.get('sms_manager', '@sms_manager[0]', 'readport')  || '';
			let smsCount  = parseInt(uci.get('sms_manager', '@sms_manager[0]', 'sms_count') || '0') || 0;

			let defmodemSections = uci.sections('defmodems', 'defmodems') || [];
			let mmModems = defmodemSections.filter(function(s) {
				return s.modemdata === 'mm';
			}).slice(0, 5);

			let hasDefmodems = mmModems.length > 0;

			if (hasDefmodems) {
				let modemsToLoad = mmModems.map(function(modem, i) {
					return {
						index:          i + 1,
						comm_port:      modem.comm_port      || readport,
						forced_plmn_op: modem.forced_plmn_op || '0',
						modemName:      modem.modem          || (_('Modem') + ' ' + (i + 1)),
						savedSmsCount:  smsCount,
						hasFullData:    true
					};
				});

				window.smsmgrData = { modems: modemsToLoad, mode: 'multi' };
				return window.smsmgrData;
			}

			window.smsmgrData = {
				modems: [{
					index:         1,
					comm_port:     readport,
					forced_plmn_op:'0',
					modemName:     'Modem',
					savedSmsCount: smsCount,
					hasFullData:   false
				}],
				mode: 'sms-only'
			};
			return window.smsmgrData;

		}, this));
	},

	render: function(data) {
		this.addStyles();

		if (!data || !data.modems || data.modems.length === 0) return null;

		let currentAlignment = this.restoreAlignmentSettings();
		let container = E('div', {
			'class': 'network-status-table',
			'style': 'display:flex;flex-wrap:wrap;gap:6px;' + this.getAlignmentStyle(currentAlignment)
		});

		let self = this;
		let onHeaderClick = function(ev) {
			ev.stopPropagation();
			self.showAlignmentModal(container);
		};

		data.modems.forEach(L.bind(function(modem) {
			let badgeId = 'smsmgr-badge-' + modem.index;

			if (window.smsmgrCache && window.smsmgrCache[modem.index]) {
				container.appendChild(
					this.renderModemBadge(window.smsmgrCache[modem.index], modem.hasFullData, onHeaderClick)
				);
				return;
			}

			let boxStyle = modem.hasFullData
				? 'margin:0.2em;flex:1;min-width:160px;max-width:220px;'
				: 'margin:0.2em;flex:1;min-width:80px;max-width:100px;';

			container.appendChild(
				E('div', {
					'class': 'ifacebox smsmgr-info-box',
					'style': boxStyle,
					'id': badgeId
				}, [
					E('div', {
						'class': 'ifacebox-head port-label',
						'style': 'padding:4px 6px;font-weight:normal;font-size:13px;cursor:pointer;',
						'click': onHeaderClick
					}, [
						E('span', {
							'class': 'smsmgr-name-truncate',
							'title': modem.modemName || _('Modem')
						}, modem.modemName || _('Modem'))
					]),
					E('div', {
						'class': 'ifacebox-body',
						'style': 'padding:8px;text-align:center;display:flex;align-items:center;justify-content:center;gap:6px;'
					}, [
						E('span', { 'class': 'spinning', 'style': 'display:inline-block;' }),
						E('span', { 'style': 'font-size:12px;' }, _('Loading...'))
					])
				])
			);

			let modemDataPromise = modem.hasFullData
				? this.getModemDataMm(modem.comm_port, modem.forced_plmn_op)
				: Promise.resolve(null);

			let sleepPromise = new Promise(function(resolve) { setTimeout(resolve, 1500); });

			Promise.all([
				modemDataPromise,
				this.getSmsCountViaMmcli(modem.comm_port),
				sleepPromise
			]).then(L.bind(function(results) {
				let mmData        = results[0];
				let currentSms    = results[1];
				let newSmsCount   = Math.max(0, currentSms - (modem.savedSmsCount || 0));

				let modemInfo = {
					operator:      mmData ? (mmData.operator      || '-') : '-',
					mode:          mmData ? (mmData.mode          || '-') : '-',
					signalQuality: mmData ? (mmData.signalQuality  || 0)  : 0,
					modemName:     modem.modemName || _('Modem'),
					smsCount:      newSmsCount
				};

				if (!window.smsmgrCache) window.smsmgrCache = {};
				window.smsmgrCache[modem.index] = modemInfo;

				let el = document.getElementById(badgeId);
				if (el) {
					let newBadge = this.renderModemBadge(modemInfo, modem.hasFullData, onHeaderClick);
					newBadge.id = badgeId;
					el.parentNode.replaceChild(newBadge, el);
				}
			}, this));

		}, this));

		return container;
	}
});
