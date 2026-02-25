'use strict';
'require baseclass';
'require form';
'require fs';
'require view';
'require uci';
'require ui';
'require rpc';
'require tools.widgets as widgets'

/*
	Copyright 2026 Rafał Wabik - IceG - From eko.one.pl forum

	Licensed to the GNU General Public License v3.0.
*/

function popTimeout(a, message, timeout, severity) {
	ui.addTimeLimitedNotification(a, message, timeout, severity);
}

function getDateTimeSuffix() {
	let now = new Date();
	let pad = function(n) { return String(n).padStart(2, '0'); };
	return now.getFullYear() + '-' +
		pad(now.getMonth() + 1) + '-' +
		pad(now.getDate()) + '_' +
		pad(now.getHours()) + '-' +
		pad(now.getMinutes()) + '-' +
		pad(now.getSeconds());
}

var pkg = {
	get Name() { return 'mailsend'; },
	get URL()  { return 'https://openwrt.org/packages/pkgdata/' + this.Name + '/'; },
	bestPkgMgrURI: function() {
		return L.resolveDefault(
			fs.stat('/www/luci-static/resources/view/system/package-manager.js'), null
		).then(function(st) {
			if (st && st.type === 'file') return 'admin/system/package-manager';
			return L.resolveDefault(fs.stat('/usr/libexec/package-manager-call'), null)
				.then(function(st2) { return st2 ? 'admin/system/package-manager' : 'admin/system/opkg'; });
		}).catch(function() { return 'admin/system/opkg'; });
	},
	openInstallerSearch: function(query) {
		let self = this;
		return self.bestPkgMgrURI().then(function(uri) {
			let q = query ? ('?query=' + encodeURIComponent(query)) : '';
			window.open(L.url(uri) + q, '_blank', 'noopener');
		});
	},
	checkPackages: function() {
		return fs.exec_direct('/usr/bin/opkg', ['list-installed'], 'text')
			.catch(function() {
				return fs.exec_direct('/usr/libexec/opkg-call', ['list-installed'], 'text')
					.catch(function() {
						return fs.exec_direct('/usr/libexec/package-manager-call', ['list-installed'], 'text')
							.catch(function() { return ''; });
					});
			})
			.then(function(data) {
				data = (data || '').trim();
				return data ? data.split('\n') : [];
			});
	},
	_isPackageInstalled: function(pkgName) {
		return this.checkPackages().then(function(installedPackages) {
			return installedPackages.some(function(pkg) { return pkg.includes(pkgName); });
		});
	}
};

let phonebookEditorDialog = baseclass.extend({
	__init__: function(title, content) {
		this.title   = title;
		this.content = content || '';
	},

	render: function() {
		let self = this;
		ui.showModal(this.title, [
			E('textarea', {
				'id': 'smsmgr_phonebook_editor', 'class': 'cbi-input-textarea',
				'style': 'width:100% !important; height:50vh; min-height:300px;',
				'wrap': 'off', 'spellcheck': 'false'
			}, this.content.trim()),

			E('div', { 'style': 'display:flex; justify-content:space-between; align-items:center; margin-top:10px;' }, [
				E('div', {}, [ E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close')) ]),
				E('div', { 'style': 'display:flex; gap:10px; align-items:center;' }, [
					(function() {
						var comboBtn = new ui.ComboButton('_load_user', {
							'_load_user': _('Load .user file'),
							'_save_user': _('Save .user file')
						}, {
							'click': function(ev, name) {
								if (name === '_load_user') {
									let input = document.createElement('input');
									input.type = 'file'; input.accept = '.user';
									input.onchange = function(e) {
										let file = e.target.files[0];
										if (!file) return;
										let reader = new FileReader();
										reader.onload = function(event) {
											let targetPath = '/etc/modem/sms_manager_phonebook.user';
											fs.write(targetPath, event.target.result)
												.then(function() {
													popTimeout(null, E('p', {}, _('File uploaded and saved to') + ' ' + targetPath), 5000, 'info');
													return fs.read(targetPath);
												})
												.then(function(c) {
													let ta = document.getElementById('smsmgr_phonebook_editor');
													if (ta) ta.value = c;
												})
												.catch(function(e) { ui.addNotification(null, E('p', {}, _('Unable to upload file') + ': ' + e.message), 'error'); });
										};
										reader.readAsText(file);
									};
									input.click();
								} else if (name === '_save_user') {
									let ta   = document.getElementById('smsmgr_phonebook_editor');
									let blob = new Blob([ta ? ta.value : ''], { type: 'text/plain' });
									let link = document.createElement('a');
									link.download = 'sms_manager_phonebook_' + getDateTimeSuffix() + '.user';
									link.href = URL.createObjectURL(blob);
									link.click(); URL.revokeObjectURL(link.href);
								}
							},
							'classes': { '_load_user': 'cbi-button cbi-button-action important', '_save_user': 'cbi-button cbi-button-neutral' }
						});
						return comboBtn.render();
					})(),
					E('button', {
						'class': 'btn cbi-button-save',
						'click': ui.createHandlerFn(this, function() {
							let ta = document.getElementById('smsmgr_phonebook_editor');
							fs.write('/etc/modem/sms_manager_phonebook.user', ta.value.trim().replace(/\r\n/g, '\n') + '\n')
								.then(function() { popTimeout(null, E('p', {}, _('Phonebook saved successfully')), 5000, 'info'); ui.hideModal(); })
								.catch(function(e) { ui.addNotification(null, E('p', {}, _('Unable to save the file') + ': ' + e.message), 'error'); });
						})
					}, _('Save'))
				])
			])
		], 'cbi-modal');
	},
	show: function() { this.render(); }
});

function makeFileManagerDialog(cfg) {
	return baseclass.extend({
		__init__: function(title) {
			this.title        = title;
			this.baseDir      = cfg.baseDir;
			this.fallbackFile = cfg.fallbackFile;
			this.currentFile  = null;
		},

		loadFileList: function() {
			return fs.exec('/bin/sh', ['-c', 'ls ' + this.baseDir + '/*.user 2>/dev/null || true'])
				.then(function(res) {
					let files = (res.stdout || '').trim().split('\n').filter(function(f) { return f; });
					let names = files.map(function(f) { return f.replace(this.baseDir + '/', ''); }.bind(this));
					names.sort();
					return names;
				}.bind(this))
				.catch(function() { return []; });
		},

		loadInitialContent: function() {
			let self = this;
			return this.loadFileList().then(function(files) {
				if (files.length > 0) {
					self.currentFile = files[0];
					return fs.read(self.baseDir + '/' + files[0])
						.then(function(c) { return { files: files, content: c || '', selectedFile: files[0] }; })
						.catch(function()  { return { files: files, content: '',   selectedFile: files[0] }; });
				}
				return fs.read(self.fallbackFile)
					.then(function(c) { return { files: [], content: c || '', selectedFile: '' }; })
					.catch(function()  { return { files: [], content: '',   selectedFile: '' }; });
			});
		},

		loadFileContent: function(fileName) {
			fs.read(this.baseDir + '/' + fileName)
				.then(function(c) {
					let ta = document.getElementById(cfg.editorId);
					if (ta) ta.value = c || '';
				})
				.catch(function(e) { ui.addNotification(null, E('p', {}, _('Unable to load file') + ': ' + e.message), 'error'); });
		},

		createNewFile: function() {
			let input    = document.getElementById(cfg.filenameId);
			let fileName = input.value.trim();
			if (!fileName) { ui.addNotification(null, E('p', {}, _('Please enter a file name')), 'warning'); return; }
			if (!fileName.endsWith('.user')) fileName += '.user';
			let filePath = this.baseDir + '/' + fileName;
			fs.exec('/bin/sh', ['-c', 'mkdir -p ' + this.baseDir])
				.then(function() { return fs.write(filePath, ''); }.bind(this))
				.then(function() { return fs.exec('/bin/chmod', ['644', filePath]); })
				.then(function() {
					popTimeout(null, E('p', {}, _('File created successfully')), 5000, 'info');
					this.currentFile = fileName; input.value = '';
					let sel = document.getElementById(cfg.selectId);
					let opt = E('option', { 'value': fileName, 'selected': 'selected' }, fileName);
					sel.appendChild(opt); sel.value = fileName;
					let ta = document.getElementById(cfg.editorId);
					if (ta) { ta.value = ''; ta.placeholder = ''; }
				}.bind(this))
				.catch(function(e) { ui.addNotification(null, E('p', {}, _('Unable to create file') + ': ' + e.message), 'error'); });
		},

		deleteFile: function() {
			let sel = document.getElementById(cfg.selectId);
			let fileName = sel.value;
			if (!fileName) { ui.addNotification(null, E('p', {}, _('Please select a file to delete')), 'warning'); return; }
			if (!confirm(_('Are you sure you want to delete this file?') + '\n' + fileName)) return;
			fs.exec('/bin/rm', ['-f', this.baseDir + '/' + fileName])
				.then(function() {
					popTimeout(null, E('p', {}, _('File deleted successfully')), 5000, 'info');
					let opt = sel.querySelector('option[value="' + fileName + '"]');
					if (opt) opt.remove();
					sel.value = ''; this.currentFile = null;
					let ta = document.getElementById(cfg.editorId);
					if (ta) { ta.value = ''; ta.placeholder = _('Select or create a file to edit...'); }
				}.bind(this))
				.catch(function(e) { ui.addNotification(null, E('p', {}, _('Unable to delete file') + ': ' + e.message), 'error'); });
		},

		deleteAllFiles: function() {
			if (!confirm(_('Are you sure you want to delete all files in the folder?') + '\n' + this.baseDir)) return;
			let self = this;
			fs.exec('/bin/sh', ['-c', 'rm -f ' + this.baseDir + '/*.user'])
				.then(function() {
					popTimeout(null, E('p', {}, _('All files deleted successfully')), 5000, 'info');
					let sel = document.getElementById(cfg.selectId);
					if (sel) { while (sel.options.length > 1) sel.remove(1); sel.value = ''; }
					self.currentFile = null;
					let ta = document.getElementById(cfg.editorId);
					if (ta) { ta.value = ''; ta.placeholder = _('Select or create a file to edit...'); }
				})
				.catch(function(e) { ui.addNotification(null, E('p', {}, _('Unable to delete files') + ': ' + e.message), 'error'); });
		},

		saveFile: function() {
			if (!this.currentFile) { ui.addNotification(null, E('p', {}, _('Please select or create a file first')), 'warning'); return; }
			let ta = document.getElementById(cfg.editorId);
			fs.write(this.baseDir + '/' + this.currentFile, ta.value.trim().replace(/\r\n/g, '\n') + '\n')
				.then(function() { popTimeout(null, E('p', {}, _('File saved successfully')), 5000, 'info'); })
				.catch(function(e) { ui.addNotification(null, E('p', {}, _('Unable to save file') + ': ' + e.message), 'error'); });
		},

		render: function() {
			let self = this;
			this.loadInitialContent().then(function(data) {
				ui.showModal(self.title, [
					E('div', { 'class': 'cbi-section' }, [
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, _('Select file')),
							E('div', { 'class': 'cbi-value-field' }, [
								E('select', {
									'class': 'cbi-input-select', 'id': cfg.selectId, 'style': 'width:100%;',
									'change': function() {
										let fn = this.value;
										if (fn) { self.currentFile = fn; self.loadFileContent(fn); }
									}
								}, [E('option', { 'value': '' }, _('-- Select file --'))].concat(
									data.files.map(function(f) { return E('option', { 'value': f }, f); })
								))
							])
						]),
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, _('New file name')),
							E('div', { 'class': 'cbi-value-field' }, [
								E('div', { 'style': 'display:flex; gap:10px;' }, [
									E('input', { 'class': 'cbi-input-text', 'id': cfg.filenameId, 'type': 'text', 'placeholder': _('filename.user'), 'style': 'flex:1;' }),
									E('button', { 'class': 'btn cbi-button-add', 'click': ui.createHandlerFn(self, self.createNewFile) }, _('Create'))
								])
							])
						]),
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, _('Deleting files')),
							E('div', { 'class': 'cbi-value-field' }, [
								(function() {
									var delCombo = new ui.ComboButton('_delete_selected', {
										'_delete_selected': _('Delete selected file'),
										'_delete_all':      _('Delete all files')
									}, {
										'click': function(ev, name) {
											if (name === '_delete_selected') self.deleteFile();
											else if (name === '_delete_all') self.deleteAllFiles();
										},
										'classes': { '_delete_selected': 'cbi-button cbi-button-remove', '_delete_all': 'cbi-button cbi-button-remove' }
									});
									return delCombo.render();
								})()
							])
						])
					]),
					E('textarea', {
						'id': cfg.editorId, 'class': 'cbi-input-textarea',
						'style': 'width:100% !important; height:40vh; min-height:250px; margin-top:10px;',
						'wrap': 'off', 'spellcheck': 'false',
						'placeholder': _('Select or create a file to edit...')
					}, data.content),

					E('div', { 'style': 'display:flex; justify-content:space-between; align-items:center; margin-top:10px;' }, [
						E('div', {}, [ E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close')) ]),
						E('div', { 'style': 'display:flex; gap:10px; align-items:center;' }, [
							(function() {
								var comboBtn = new ui.ComboButton('_load_user', {
									'_load_user': _('Load .user file'),
									'_save_user': _('Save .user file'),
									'_load_gz':   _('Load .gz archive'),
									'_save_gz':   _('Save .gz archive')
								}, {
									'click': function(ev, name) {
										if (name === '_load_user') {
											let input = document.createElement('input');
											input.type = 'file'; input.accept = '.user';
											input.onchange = function(e) {
												let file = e.target.files[0]; if (!file) return;
												let reader = new FileReader();
												reader.onload = function(event) {
													let fileName   = file.name;
													let targetPath = self.baseDir + '/' + fileName;
													fs.write(targetPath, event.target.result)
														.then(function() {
															popTimeout(null, E('p', {}, _('File uploaded and saved to') + ' ' + targetPath), 5000, 'info');
															self.currentFile = fileName;
															return self.loadFileList();
														})
														.then(function(files) {
															let sel = document.getElementById(cfg.selectId);
															if (sel) {
																while (sel.options.length > 1) sel.remove(1);
																files.forEach(function(f) {
																	let opt = document.createElement('option');
																	opt.value = f; opt.text = f;
																	if (f === fileName) opt.selected = true;
																	sel.appendChild(opt);
																});
															}
															return fs.read(targetPath);
														})
														.then(function(c) {
															let ta = document.getElementById(cfg.editorId);
															if (ta) ta.value = c;
														})
														.catch(function(e) { ui.addNotification(null, E('p', {}, _('Unable to upload file') + ': ' + e.message), 'error'); });
												};
												reader.readAsText(file);
											};
											input.click();
										} else if (name === '_save_user') {
											let ta       = document.getElementById(cfg.editorId);
											let baseName = (self.currentFile || cfg.fallbackFile.split('/').pop()).replace(/\.user$/, '');
											let blob     = new Blob([ta ? ta.value : ''], { type: 'text/plain' });
											let link     = document.createElement('a');
											link.download = baseName + '_' + getDateTimeSuffix() + '.user';
											link.href = URL.createObjectURL(blob);
											link.click(); URL.revokeObjectURL(link.href);
										} else if (name === '_load_gz') {
											let tmpPath = '/tmp/smsmgr_' + cfg.archivePrefix + '_upload.tar.gz';
											ui.uploadFile(tmpPath)
												.then(function() { return fs.exec('/bin/sh', ['-c', 'mkdir -p ' + self.baseDir]); })
												.then(function() { return fs.exec('/bin/tar', ['-xzf', tmpPath, '-C', self.baseDir]); })
												.then(function(res) {
													if (res.code !== 0) { ui.addNotification(null, E('p', {}, _('Failed to extract archive') + ': ' + (res.stderr || '')), 'error'); return; }
													return fs.exec('/bin/rm', ['-f', tmpPath]).then(function() {
														popTimeout(null, E('p', {}, _('Archive extracted to') + ' ' + self.baseDir), 5000, 'info');
														return self.loadFileList();
													}).then(function(files) {
														let sel = document.getElementById(cfg.selectId);
														if (sel) {
															while (sel.options.length > 1) sel.remove(1);
															files.forEach(function(f) { let opt = document.createElement('option'); opt.value = f; opt.text = f; sel.appendChild(opt); });
														}
													});
												})
												.catch(function(e) { ui.addNotification(null, E('p', {}, _('Upload error') + ': ' + e.message), 'error'); });
										} else if (name === '_save_gz') {
											let tmpGz = '/tmp/smsmgr_' + cfg.archivePrefix + '.tar.gz';
											fs.exec('/bin/tar', ['-czf', tmpGz, '-C', self.baseDir, '.'])
												.then(function(res) {
													if (res.code !== 0) { ui.addNotification(null, E('p', {}, _('Failed to create archive') + ': ' + (res.stderr || '')), 'error'); return; }
													return L.resolveDefault(fs.read_direct(tmpGz, 'blob'), null).then(function(blob) {
														if (blob) {
															let link = document.createElement('a');
															link.download = 'smsmgr_' + cfg.archivePrefix + '_' + getDateTimeSuffix() + '.tar.gz';
															link.href = URL.createObjectURL(blob);
															link.click(); URL.revokeObjectURL(link.href);
														} else { ui.addNotification(null, E('p', {}, _('Failed to read archive')), 'error'); }
														return fs.exec('/bin/rm', ['-f', tmpGz]);
													});
												})
												.catch(function(e) { ui.addNotification(null, E('p', {}, _('Error') + ': ' + e.message), 'error'); });
										}
									},
									'classes': {
										'_load_user': 'cbi-button cbi-button-action important',
										'_save_user': 'cbi-button cbi-button-neutral',
										'_load_gz':   'cbi-button cbi-button-action important',
										'_save_gz':   'cbi-button cbi-button-neutral'
									}
								});
								return comboBtn.render();
							})(),
							E('button', { 'class': 'btn cbi-button-save', 'click': ui.createHandlerFn(self, self.saveFile) }, _('Save'))
						])
					])
				], 'cbi-modal');

				setTimeout(function() {
					let sel = document.getElementById(cfg.selectId);
					if (sel && data.selectedFile) sel.value = data.selectedFile;
				}, 0);
			});
		},

		show: function() { this.render(); }
	});
}

let ussdCodesManagerDialog = makeFileManagerDialog({
	baseDir:       '/etc/modem/sms_manager_ussdcodes',
	fallbackFile:  '/etc/modem/sms_manager_ussdcodes.user',
	editorId:      'smsmgr_ussd_editor',
	selectId:      'smsmgr_ussd_select',
	filenameId:    'smsmgr_ussd_filename',
	archivePrefix: 'ussdcodes'
});

let atCommandsManagerDialog = makeFileManagerDialog({
	baseDir:       '/etc/modem/sms_manager_atcmmds',
	fallbackFile:  '/etc/modem/sms_manager_atcmmds.user',
	editorId:      'smsmgr_at_editor',
	selectId:      'smsmgr_at_select',
	filenameId:    'smsmgr_at_filename',
	archivePrefix: 'atcmmds'
});

return view.extend({
	load: function() {
		return L.resolveDefault(fs.exec_direct('/usr/bin/mmcli', ['-L', '-J']), null)
			.then(function(res) {
				var modems = [];
				if (res) {
					try {
						var data = JSON.parse(res);
						if (data && data['modem-list'] && Array.isArray(data['modem-list'])) {
							data['modem-list'].forEach(function(modem) {
								if (modem) {
									var modemNum = modem.split('/').pop();
									modems.push({ path: modem, index: modemNum, displayName: 'ModemManager Modem ' + modemNum });
								}
							});
						}
					} catch (e) { console.error('Error parsing ModemManager data:', e); }
				}
				return modems;
			})
			.catch(function(err) { console.error('Error modem detect:', err); return []; });
	},

	render: function(modems) {
		let m, s, o;
		m = new form.Map('sms_manager', _('Configuration SMS Manager'), _('Configuration panel for SMS Manager application.'));
		s = m.section(form.TypedSection, 'sms_manager', '', null);
		s.anonymous = true;

		modems.sort(function(a, b) { return a.index > b.index ? 1 : -1; });

		// TAB SMS
		s.tab('smstab', _('SMS Settings'));

		o = s.taboption('smstab', form.ListValue, 'readport', _('SMS reading modem'),
			_('Select one of the available modems from ModemManager.'));
		modems.forEach(function(modem) { o.value(modem.path, modem.displayName); });
		o.placeholder = _('Please select a modem'); o.rmempty = false;

		o = s.taboption('smstab', form.Value, 'bnumber', _('Phone number to be blurred'),
			_('The last 5 digits of this number will be blurred.'));
		o.password = true;

		o = s.taboption('smstab', form.Flag, 'information', _('Explanation of number and prefix'),
			_('In the tab for sending SMSes, show an explanation of the prefix and the correct phone number.'));
		o.rmempty = false;

		o = s.taboption('smstab', form.Button, '_fsave');
		o.title = _('Save messages to a text file');
		o.description = _('This option allows to backup SMS messages or, for example, save messages that are not supported by ModemManager.');
		o.inputtitle = _('Save as .txt file');
		o.onclick = function() {
			return uci.load('sms_manager').then(function() {
				let modemPath = uci.get('sms_manager', '@sms_manager[0]', 'readport');
				if (!modemPath) { ui.addNotification(null, E('p', {}, _('Please configure SMS reading modem first')), 'info'); return; }
				let modemNum = modemPath.split('/').pop();
				L.resolveDefault(fs.exec_direct('/usr/bin/mmcli', ['-m', modemNum, '--messaging-list-sms']), null)
					.then(function(listRes) {
						if (!listRes) { ui.addNotification(null, E('p', {}, _('No SMS messages found on modem')), 'info'); return; }
						let smsIds = []; let matches = listRes.matchAll(/\/SMS\/(\d+)/g);
						for (let match of matches) smsIds.push(match[1]);
						if (smsIds.length === 0) { ui.addNotification(null, E('p', {}, _('No SMS messages found')), 'info'); return; }
						Promise.all(smsIds.map(function(id) {
							return L.resolveDefault(fs.exec_direct('/usr/bin/mmcli', ['-s', id]), null);
						})).then(function(smsResults) {
							let allSmsText = ''; let validSmsCount = 0;
							smsResults.forEach(function(smsRes) {
								if (!smsRes) return;
								let number = ''; let text = ''; let timestamp = '';
								let nm = smsRes.match(/number:\s*(.+?)$/m); if (nm) number = nm[1].trim();
								let tm = smsRes.match(/text:\s*([\s\S]+?)(?=\n\s*-{2,}|\n\s*Properties)/);
								if (tm) text = tm[1].split('\n').map(function(l) { return l.replace(/^\s*\|?\s*/, '').trim(); }).filter(function(l) { return l.length > 0; }).join(' ').trim();
								let tsm = smsRes.match(/timestamp:\s*(?:'([^']+)'|(\S+))/);
								if (tsm) {
									timestamp = (tsm[1] || tsm[2] || '').trim();
									try {
										let d = new Date(timestamp.replace(/([+-]\d{2})$/, '$1:00'));
										if (d && !isNaN(d.getTime())) timestamp = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
									} catch(e) {}
								}
								if (number && text) { validSmsCount++; allSmsText += 'From: ' + number + '\nDate: ' + (timestamp || 'Unknown') + '\nMessage: ' + text + '\n\n'; }
							});
							if (validSmsCount === 0) { ui.addNotification(null, E('p', {}, _('No valid SMS messages to save')), 'info'); return; }
							fs.write('/tmp/mysms_manager.txt', allSmsText);
							fs.stat('/tmp/mysms_manager.txt').then(function() {
								if (confirm(_('Save ' + validSmsCount + ' SMS messages to txt file?'))) {
									L.resolveDefault(fs.read_direct('/tmp/mysms_manager.txt'), null).then(function(restxt) {
										if (restxt) {
											L.ui.showModal(_('Saving...'), [E('p', { 'class': 'spinning' }, _('Please wait..'))]);
											let link = E('a', { 'download': 'mysms_manager.txt', 'href': URL.createObjectURL(new Blob([restxt], { type: 'text/plain' })) });
											window.setTimeout(function() { link.click(); URL.revokeObjectURL(link.href); L.hideModal(); }, 2000);
										} else { ui.addNotification(null, E('p', {}, _('Saving SMS messages to a file failed. Please try again'))); }
									}).catch(function(err) { ui.addNotification(null, E('p', {}, _('Download error: ') + err.message)); });
								}
							});
						}).catch(function(err) { ui.addNotification(null, E('p', {}, _('Error reading SMS messages: ') + err.message)); });
					})
					.catch(function(err) { ui.addNotification(null, E('p', {}, _('Error listing SMS: ') + err.message)); });
			});
		};

		o = s.taboption('smstab', form.Button, '_fdelete');
		o.title = _('Delete all messages');
		o.description = _("This option allows you to delete all SMS messages when they are not visible in the 'Received Messages' tab.");
		o.inputtitle = _('Delete all');
		o.onclick = function() {
			if (!confirm(_('Delete all the messages?'))) return;
			return uci.load('sms_manager').then(function() {
				let modemPath = uci.get('sms_manager', '@sms_manager[0]', 'readport');
				if (!modemPath) { ui.addNotification(null, E('p', {}, _('Please configure SMS reading modem first')), 'info'); return; }
				let modemNum = modemPath.split('/').pop();
				L.resolveDefault(fs.exec_direct('/usr/bin/mmcli', ['-m', modemNum, '--messaging-list-sms']), null)
					.then(function(listRes) {
						if (!listRes) { ui.addNotification(null, E('p', {}, _('No SMS messages found')), 'info'); return; }
						let smsIds = []; let matches = listRes.matchAll(/\/SMS\/(\d+)/g);
						for (let match of matches) smsIds.push(match[1]);
						if (smsIds.length === 0) { ui.addNotification(null, E('p', {}, _('No SMS messages found')), 'info'); return; }
						Promise.all(smsIds.map(function(id) {
							return fs.exec('/usr/bin/mmcli', ['-m', modemNum, '--messaging-delete-sms=' + id]);
						})).then(function() {
							uci.set('sms_manager', '@sms_manager[0]', 'sms_count', '0');
							return uci.save().then(function() { return uci.apply(); }).then(function() {
								ui.addNotification(null, E('p', {}, _('All messages deleted successfully')), 'info');
							});
						}).catch(function(err) { ui.addNotification(null, E('p', {}, _('Error deleting messages: ') + err.message), 'error'); });
					});
			});
		};

		o = s.taboption('smstab', form.ListValue, 'sendport', _('SMS sending modem'),
			_('Select one of the available modems from ModemManager.'));
		modems.forEach(function(modem) { o.value(modem.path, modem.displayName); });
		o.placeholder = _('Please select a modem'); o.rmempty = false;

		o = s.taboption('smstab', form.Value, 'pnumber', _('Phone number prefix'),
			_('Country prefix for phone numbers (for Poland it is +48).'));
		o.default = '+48';
		o.validate = function(section_id, value) {
			if (value.match(/^\+?[0-9]+$/)) return true;
			return _('Expected format: +decimal value or decimal value');
		};

		o = s.taboption('smstab', form.Flag, 'prefix', _('Add prefix to phone number'),
			_('Automatically add prefix to the phone number field.'));
		o.rmempty = false;

		o = s.taboption('smstab', form.Flag, 'sendingroup', _('Enable group messaging'),
			_("This option allows you to send one message to all contacts in the user's contact list."));
		o.rmempty = false; o.default = false;

		o = s.taboption('smstab', form.Button, '_phonebook_edit');
		o.title = _('User contacts');
		o.description = _("Each line must have the following format: 'Contact name;phone number'. For user convenience, the file is saved to the location <code>/etc/modem/sms_manager_phonebook.user</code>.");
		o.inputtitle = _('Manage contacts');
		o.onclick = function() {
			return fs.trimmed('/etc/modem/sms_manager_phonebook.user')
				.then(function(content) { new phonebookEditorDialog(_('Edit User Contacts'), content || '').show(); })
				.catch(function() { new phonebookEditorDialog(_('Edit User Contacts'), '').show(); });
		};

		// TAB E-MAIL
		s.tab('email', _('SMS Forwarding to E-mail Settings'));

		var emailProviders = {
			'custom':     { name: _('user define'),        smtp: '',                      port: '',    security: 'tls' },
			'gmail':      { name: 'Gmail',                 smtp: 'smtp.gmail.com',         port: '587', security: 'tls' },
			'outlook':    { name: 'Outlook.com / Hotmail', smtp: 'smtp-mail.outlook.com',  port: '587', security: 'tls' },
			'yahoo':      { name: 'Yahoo Mail',            smtp: 'smtp.mail.yahoo.com',    port: '587', security: 'tls' },
			'icloud':     { name: 'iCloud Mail',           smtp: 'smtp.mail.me.com',       port: '587', security: 'tls' },
			'aol':        { name: 'AOL Mail',              smtp: 'smtp.aol.com',           port: '587', security: 'tls' },
			'zoho':       { name: 'Zoho Mail',             smtp: 'smtp.zoho.com',          port: '587', security: 'tls' },
			'mailru':     { name: 'Mail.ru',               smtp: 'smtp.mail.ru',           port: '465', security: 'ssl' },
			'yandex':     { name: 'Yandex.Mail',           smtp: 'smtp.yandex.com',        port: '465', security: 'ssl' },
			'gmx':        { name: 'GMX Mail',              smtp: 'smtp.gmx.com',           port: '587', security: 'tls' },
			'mailcom':    { name: 'Mail.com',              smtp: 'smtp.mail.com',          port: '587', security: 'tls' },
			'fastmail':   { name: 'FastMail',              smtp: 'smtp.fastmail.com',      port: '587', security: 'tls' },
			'sina':       { name: 'Sina Mail',             smtp: 'smtp.sina.com',          port: '587', security: 'tls' },
			'mailboxorg': { name: 'Mailbox.org',           smtp: 'smtp.mailbox.org',       port: '587', security: 'tls' },
			'o2pl':       { name: 'o2.pl',                 smtp: 'poczta.o2.pl',           port: '465', security: 'ssl' },
			'wppl':       { name: 'wp.pl',                 smtp: 'smtp.wp.pl',             port: '465', security: 'ssl' },
			'interia':    { name: 'interia.pl',            smtp: 'poczta.interia.pl',      port: '465', security: 'ssl' }
		};

		o = s.taboption('email', form.Flag, 'forward_sms_enabled', _('Enable message forwarding'));
		o.rmempty = false; o.modalonly = true;
		o.write = function(section_id, value) {
			if (value === '1') {
				return pkg._isPackageInstalled('mailsend').then(function(isInstalled) {
					if (!isInstalled) {
						ui.addNotification(null, E('p', {}, _('Package mailsend is not installed. Please install it first using the Install... button below')), 'info');
						return form.Flag.prototype.write.apply(this, [section_id, '0']);
					}
					return form.Flag.prototype.write.apply(this, [section_id, value]);
				}.bind(this));
			}
			return form.Flag.prototype.write.apply(this, [section_id, value]);
		};

		o = s.taboption('email', form.ListValue, 'emailprovider', _('E-mail settings'),
			_('Select a predefined e-mail settings or enter settings manually.'));
		for (var key in emailProviders) o.value(key, emailProviders[key].name);
		o.default = 'custom'; o.modalonly = true;
		o.onchange = function(ev, section_id, value) {
			var provider = emailProviders[value] || emailProviders['custom']; var map = this.map;
			var f = map.lookupOption('forward_sms_mail_smtp', section_id); if (f && f[0]) f[0].getUIElement(section_id).setValue(provider.smtp);
			f = map.lookupOption('forward_sms_mail_smtp_port', section_id); if (f && f[0]) f[0].getUIElement(section_id).setValue(provider.port);
			f = map.lookupOption('forward_sms_mail_security', section_id); if (f && f[0]) f[0].getUIElement(section_id).setValue(provider.security);
		};

		o = s.taboption('email', form.Value, 'forward_sms_mail_recipient', _('Recipient')); o.description = _('E-mail address of the recipient.'); o.modalonly = true;
		o = s.taboption('email', form.Value, 'forward_sms_mail_sender', _('Sender'));       o.description = _('E-mail address of the sender.');     o.modalonly = true;
		o = s.taboption('email', form.Value, 'forward_sms_mail_user', _('User'));           o.description = _('Username for SMTP authentication.');  o.modalonly = true;
		o = s.taboption('email', form.Value, 'forward_sms_mail_password', _('Password'));
		o.description = _('Google app password / Password for SMTP authentication.'); o.password = true; o.modalonly = true;
		o = s.taboption('email', form.Value, 'forward_sms_mail_smtp', _('SMTP server'));
		o.description = _('Hostname/IP address of the SMTP server.'); o.datatype = 'host'; o.modalonly = true;
		o = s.taboption('email', form.Value, 'forward_sms_mail_smtp_port', _('SMTP server port')); o.datatype = 'port'; o.modalonly = true;
		o = s.taboption('email', form.ListValue, 'forward_sms_mail_security', _('Security'));
		o.description = '%s<br />%s'.format(_('TLS: use STARTTLS if the server supports it.'), _('SSL: SMTP over SSL.'));
		o.value('tls', 'TLS'); o.value('ssl', 'SSL'); o.default = 'tls'; o.modalonly = true;

		o = s.taboption('email', form.DummyValue, '_dummy_mailsend'); o.rawhtml = true;
		o.render = function() { return E('div', {}, [ E('h3', {}, _('Required Package')), E('div', { 'class': 'cbi-map-descr' }, _('The SMS forwarding option requires the mailsend package to be installed.')) ]); };
		o = s.taboption('email', form.DummyValue, '_mailsend_status', _('mailsend package')); o.rawhtml = true;
		o.cfgvalue = function() { return ''; };
		o.render = function(oi, si) {
			return pkg._isPackageInstalled('mailsend').then(function(isInstalled) {
				var content = isInstalled
					? E('span', { 'class': 'cbi-value-field', 'style': 'font-style:italic;' }, _('Installed'))
					: E('button', { 'class': 'cbi-button cbi-button-action', 'click': function() { pkg.openInstallerSearch('mailsend'); } }, _('Install…'));
				return E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, _('mailsend')), E('div', { 'class': 'cbi-value-field' }, content) ]);
			});
		};

		// TAB USSD
		s.tab('ussd', _('USSD Codes Settings'));

		o = s.taboption('ussd', form.ListValue, 'ussdport', _('USSD sending modem'),
			_('Select one of the available modems from ModemManager.'));
		modems.forEach(function(modem) { o.value(modem.path, modem.displayName); });
		o.placeholder = _('Please select a modem'); o.rmempty = false;

		o = s.taboption('ussd', form.Button, '_ussd_manage');
		o.title = _('User USSD codes');
		o.description = _("Each line must have the following format: 'Code description;code'. For user convenience, files are saved to <code>/etc/modem/sms_manager_ussdcodes/</code>.");
		o.inputtitle = _('Manage USSD codes');
		o.onclick = function() { new ussdCodesManagerDialog(_('Manage User USSD Codes')).show(); };

		// TAB AT
		s.tab('attab', _('AT Commands Settings'));

		o = s.taboption('attab', form.ListValue, 'atport', _('AT commands sending modem'),
			_('Select one of the available modems from ModemManager. \
			<br /><br /><b>Important</b> \
			<br />Sending AT commands via ModemManager requires the AT command interface to be compiled in. \
			This functionality is not available in the standard ModemManager package and requires custom compilation with AT command support enabled.'));
		modems.forEach(function(modem) { o.value(modem.path, modem.displayName); });
		o.placeholder = _('Please select a modem'); o.rmempty = false;

		o = s.taboption('attab', form.Button, '_at_manage');
		o.title = _('User AT commands');
		o.description = _("Each line must have the following format: 'AT command description;AT command'. For user convenience, files are saved to <code>/etc/modem/sms_manager_atcmmds/</code>.");
		o.inputtitle = _('Manage AT commands');
		o.onclick = function() { new atCommandsManagerDialog(_('Manage User AT Commands')).show(); };

		// TAB NOTIFICATION
		s.tab('notifytab', _('Notification Settings'));

		o = s.taboption('notifytab', form.Flag, 'lednotify', _('Notify new messages'),
			_('The LED informs about a new message. Before activating this function, please config and save the SMS reading modem, time to check SMS inbox and select the notification LED.'));
		o.rmempty = false; o.default = true;
		o.write = function(section_id, value) {
			return uci.load('sms_manager').then(function() {
				let portR = uci.get('sms_manager', '@sms_manager[0]', 'readport');
				let dsled = uci.get('sms_manager', '@sms_manager[0]', 'ledtype');
				let led   = uci.get('sms_manager', '@sms_manager[0]', 'smsled');
				if (!portR) {
					ui.addNotification(null, E('p', {}, _('Please configure SMS reading modem first')), 'info');
					return form.Flag.prototype.write.apply(this, [section_id, value]);
				}
				let modemNum = portR.split('/').pop();
				return L.resolveDefault(fs.exec_direct('/usr/bin/mmcli', ['-m', modemNum, '--messaging-list-sms']), null)
					.then(function(res) {
						let smsCount = 0;
						if (res) { let m = res.matchAll(/\/SMS\/(\d+)/g); for (let match of m) smsCount++; }

						if (value == '1') {
							uci.set('sms_manager', '@sms_manager[0]', 'sms_count', String(smsCount));
							uci.set('sms_manager', '@sms_manager[0]', 'lednotify', '1');
							let PTR = uci.get('sms_manager', '@sms_manager[0]', 'prestart');
							return uci.save()
								.then(function() { return L.resolveDefault(fs.read('/etc/crontabs/root'), ''); })
								.then(function(crontab) {
									let lines = (crontab || '').trim().replace(/\r\n/g, '\n').split('\n')
										.filter(function(l) { return l.trim() !== '' && !l.includes('/etc/init.d/sms_manager'); });
									lines.push('1 */' + PTR + ' * * *  /etc/init.d/sms_manager enable && /etc/init.d/sms_manager restart');
									return fs.write('/etc/crontabs/root', lines.join('\n') + '\n');
								})
								.then(function() { return fs.exec_direct('/etc/init.d/cron', ['restart']); })
								.then(function() { return fs.exec_direct('/etc/init.d/sms_manager', ['enable']); })
								.then(function() { return fs.exec_direct('/etc/init.d/sms_manager', ['start']); });
						}
						if (value == '0') {
							uci.set('sms_manager', '@sms_manager[0]', 'lednotify', '0');
							return uci.save()
								.then(function() { return L.resolveDefault(fs.read('/etc/crontabs/root'), ''); })
								.then(function(crontab) {
									let lines = (crontab || '').trim().replace(/\r\n/g, '\n').split('\n')
										.filter(function(l) { return l.trim() !== '' && !l.includes('sms_manager'); });
									return fs.write('/etc/crontabs/root', lines.join('\n') + '\n');
								})
								.then(function() { return fs.exec_direct('/etc/init.d/cron', ['restart']); })
								.then(function() { return fs.exec_direct('/etc/init.d/sms_manager', ['stop']); })
								.then(function() { return fs.exec_direct('/etc/init.d/sms_manager', ['disable']); })
								.then(function() { if (dsled == 'D' && led) return fs.write('/sys/class/leds/' + led + '/brightness', '0'); });
						}
					}.bind(this));
			}.bind(this)).then(function() {
				return form.Flag.prototype.write.apply(this, [section_id, value]);
			}.bind(this));
		};

		o = s.taboption('notifytab', form.Flag, 'ontopsms', _('Show notification icon'),
			_('Show the new message notification icon on the status overview page.'));
		o.rmempty = false;

		o = s.taboption('notifytab', form.Value, 'checktime', _('Check inbox every minute(s)'),
			_('Specify how many minutes you want your inbox to be checked.'));
		o.default = '10'; o.rmempty = false; o.datatype = 'range(5, 59)';
		o.validate = function(section_id, value) {
			if (value.match(/^[0-9]+(?:\.[0-9]+)?$/) && +value >= 5 && +value < 60) return true;
			return _('Expect a decimal value between five and fifty-nine');
		};

		o = s.taboption('notifytab', form.ListValue, 'prestart', _('Restart the inbox checking process every'),
			_('The process will restart at the selected time interval. This will eliminate the delay in checking your inbox.'));
		o.value('4', _('4h')); o.value('6', _('6h')); o.value('8', _('8h')); o.value('12', _('12h'));
		o.default = '6'; o.rmempty = false;

		o = s.taboption('notifytab', form.ListValue, 'ledtype', _('The diode is dedicated only to these notifications'),
			_("Select 'No' in case the router has only one LED or if the LED is multi-tasking. \
				<br /><br /><b>Important</b> \
				<br />This option requires LED to be defined in the system (if possible) to work properly. \
				This requirement applies when the diode supports multiple tasks."));
		o.value('S', _('No')); o.value('D', _('Yes')); o.default = 'D'; o.rmempty = false;

		o = s.taboption('notifytab', form.ListValue, 'smsled', _('<abbr title="Light Emitting Diode">LED</abbr> Name'),
			_('Select the notification LED.'));
		o.load = function(section_id) {
			return L.resolveDefault(fs.list('/sys/class/leds'), []).then(L.bind(function(leds) {
				if (leds.length > 0) { leds.sort(function(a, b) { return a.name > b.name ? 1 : -1; }); leds.forEach(function(e) { o.value(e.name); }); }
				return this.super('load', [section_id]);
			}, this));
		};
		o.exclude = s.section; o.nocreate = true; o.optional = true; o.rmempty = true;

		return m.render();
	}
});
