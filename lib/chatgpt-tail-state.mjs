export const CHATGPT_STATE_SCHEMA_VERSION = 2;

export function cleanChatLine(value = '') {
  return String(value || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
}

function noisy(value = '') {
  const text = cleanChatLine(value);
  if (!text || text.length > 900) return true;
  if (/^```/.test(text) || /^`{3}$/.test(text) || /^powershell$/i.test(text)) return true;
  if (/^(?:PS\s+[A-Z]:\\|>>|>>>|\$[A-Za-z_]\w*\s*=|Write-Host\b|Get-\w+\b|Set-\w+\b|Where-Object\b|Sort-Object\b|Select-Object\b|Format-(?:List|Table)\b|Test-Path\b|Copy-Item\b|Set-Location\b|npm(?:\s|$)|node(?:\s|$)|git(?:\s|$)|cd\s+["']?[A-Z]:\\|chrome:\/\/)/i.test(text)) return true;
  if (/(?:ConvertFrom-Json|ForegroundColor|collectorFingerprint|Get-Content|Join-Path|Format-List|Where-Object|Sort-Object|Select-Object)/i.test(text)) return true;
  if ((text.match(/[{};$|]/g) || []).length >= 5) return true;
  return false;
}

export function semanticChatLines(messages = []) {
  const out = [];
  messages.forEach((message, messageIndex) => {
    const role = String(message?.role || 'unknown').toLowerCase();
    String(message?.text || '').split(/\n+/).forEach((raw, lineIndex) => {
      const text = cleanChatLine(raw);
      if (noisy(text)) return;
      out.push({role, text, messageIndex, lineIndex});
    });
  });
  return out;
}

const ACTION_SIGNAL = /(next|resume|retest|needs? test|pending|physical gate|live test|todo|remaining|needs? to|should|must|verify|validate|\btest\b|run|open|implement|build|fix|update|send|reply|review|continue|try|compare|choose|install|configure|check)/i;

function latestExchangeLines(lines = []) {
  if (!lines.length) return [];
  const lastMessageIndex = lines[lines.length - 1].messageIndex;
  const finalRole = lines[lines.length - 1].role;
  const startMessageIndex = finalRole === 'user' ? lastMessageIndex : Math.max(0, lastMessageIndex - 1);
  return lines.filter(item => item.messageIndex >= startMessageIndex);
}

export function extractLatestChatState(messages = []) {
  const semantic = semanticChatLines(messages);
  if (!semantic.length) {
    return {
      summary:'ChatGPT delta collected.',
      currentStateSummary:'ChatGPT delta collected.',
      resumeAction:'Continue in the synced ChatGPT thread.'
    };
  }

  const tail = latestExchangeLines(semantic);
  const stateLines = tail.slice(-5);
  const currentStateSummary = stateLines
    .map(item => `${item.role.toUpperCase()}: ${item.text}`)
    .join(' · ')
    .slice(0,900);

  const latestAssistantMessageIndex = [...semantic].reverse().find(item => item.role === 'assistant')?.messageIndex;
  const actionWindow = latestAssistantMessageIndex == null
    ? tail
    : semantic.filter(item => item.messageIndex === latestAssistantMessageIndex);

  const explicit = [...actionWindow].reverse().find(item => /^(?:NEXT|TODO|ACTION|RESUME)\s*[:—-]/i.test(item.text));
  const natural = [...actionWindow].reverse().find(item => item.text.length <= 420 && ACTION_SIGNAL.test(item.text));
  const action = (explicit || natural)?.text
    ?.replace(/^\s*(?:NEXT|TODO|ACTION|RESUME)\s*[:—-]\s*/i, '')
    .slice(0,700) || 'Continue in the synced ChatGPT thread.';

  return {
    summary:currentStateSummary.slice(0,1800),
    currentStateSummary:currentStateSummary.slice(0,700),
    resumeAction:action
  };
}
