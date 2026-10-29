// Launcher page logic. Runs in a sandboxed renderer with no Node.js access; it can only
// call the three functions exposed by the preload script.
(function () {
  'use strict';
  const desktop = window.ibutestDesktop;
  const errorBox = document.getElementById('error');
  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  };
  const busy = (form, on) => form.querySelectorAll('button, input').forEach((el) => (el.disabled = on));

  desktop.getConfig().then((config) => {
    if (!config) return;
    if (config.serverUrl) document.getElementById('server-url').value = config.serverUrl;
    if (config.hasAiKey) document.getElementById('ai-key').placeholder = 'Configured - leave empty to keep it';
    document.getElementById('version').textContent = `IbuTest desktop ${config.version}`;
  });

  document.getElementById('remote-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    showError('');
    busy(form, true);
    const result = await desktop.connectRemote(document.getElementById('server-url').value);
    busy(form, false);
    if (!result || !result.ok) showError((result && result.error) || 'Could not connect.');
  });

  document.getElementById('local-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    showError('');
    busy(form, true);
    const input = document.getElementById('ai-key');
    const result = await desktop.startLocal({ anthropicApiKey: input.value });
    input.value = '';
    busy(form, false);
    if (!result || !result.ok) showError((result && result.error) || 'Could not start the local workspace.');
  });
})();
