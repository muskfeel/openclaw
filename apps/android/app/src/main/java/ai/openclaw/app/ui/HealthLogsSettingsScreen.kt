package ai.openclaw.app.ui

import ai.openclaw.app.GatewayHealthLogsSummary
import ai.openclaw.app.GatewayLogEntry
import ai.openclaw.app.MainViewModel
import ai.openclaw.app.ui.design.ClawPanel
import ai.openclaw.app.ui.design.ClawSecondaryButton
import ai.openclaw.app.ui.design.ClawStatus
import ai.openclaw.app.ui.design.ClawStatusPill
import ai.openclaw.app.ui.design.ClawTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable
internal fun HealthLogsSettingsScreen(
  viewModel: MainViewModel,
  onBack: () -> Unit,
) {
  val isConnected by viewModel.isConnected.collectAsState()
  val isNodeConnected by viewModel.isNodeConnected.collectAsState()
  val chatHealthOk by viewModel.chatHealthOk.collectAsState()
  val statusText by viewModel.statusText.collectAsState()
  val modelCount by viewModel.modelCatalog.collectAsState()
  val pendingRunCount by viewModel.pendingRunCount.collectAsState()
  val talkStatus by viewModel.talkModeStatusText.collectAsState()
  val logsSummary by viewModel.healthLogsSummary.collectAsState()
  val logsRefreshing by viewModel.healthLogsRefreshing.collectAsState()
  val logsErrorText by viewModel.healthLogsErrorText.collectAsState()

  LaunchedEffect(isConnected) {
    if (isConnected) {
      viewModel.refreshHealthLogs()
    }
  }

  SettingsDetailFrame(
    title = "健康状态",
    subtitle = "网关状态、手机节点就绪状态和最近日志流。",
    icon = Icons.Default.Settings,
    onBack = onBack,
  ) {
    SettingsMetricPanel(
      rows =
        listOf(
          SettingsMetric("网关", if (isConnected) "在线" else "离线"),
          SettingsMetric("节点", if (isNodeConnected) "在线" else "等待中"),
          SettingsMetric("模型", modelCount.size.toString()),
          SettingsMetric("日志", logsSummary.entries.size.toString()),
        ),
    )
    HealthStatusPanel(
      gateway = statusText,
      node = if (isNodeConnected) "在线" else "等待中",
      chat = if (chatHealthOk) "就绪" else 需要连接",
      models = "${modelCount.size} available",
      voice = talkStatus,
      runs = if (pendingRunCount > 0) "$pendingRunCount active" else 空闲",
      isConnected = isConnected,
      isNodeConnected = isNodeConnected,
      chatHealthOk = chatHealthOk,
      modelsReady = modelCount.isNotEmpty(),
      voiceReady = talkStatus.lowercase() != "off",
    )
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      ClawSecondaryButton(
        text = if (logsRefreshing) "刷新中" else 刷新日志",
        onClick = viewModel::refreshHealthLogs,
        enabled = isConnected && !logsRefreshing,
        modifier = Modifier.weight(1f),
      )
    }
    logsErrorText?.let { error ->
      ClawPanel {
        Text(text = error, style = ClawTheme.type.body, color = ClawTheme.colors.warning)
      }
    }
    GatewayLogsPanel(isConnected = isConnected, summary = logsSummary)
  }
}

@Composable
private fun HealthStatusPanel(
  gateway: String,
  node: String,
  chat: String,
  models: String,
  voice: String,
  runs: String,
  isConnected: Boolean,
  isNodeConnected: Boolean,
  chatHealthOk: Boolean,
  modelsReady: Boolean,
  voiceReady: Boolean,
) {
  ClawPanel(contentPadding = PaddingValues(horizontal = 0.dp, vertical = 0.dp)) {
    Column {
      HealthStatusRow(title = "网关", value = gateway, healthy = isConnected)
      HorizontalDivider(color = ClawTheme.colors.border, thickness = 1.dp)
      HealthStatusRow(title = "手机节点", value = node, healthy = isNodeConnected)
      HorizontalDivider(color = ClawTheme.colors.border, thickness = 1.dp)
      HealthStatusRow(title = "聊天", value = chat, healthy = chatHealthOk)
      HorizontalDivider(color = ClawTheme.colors.border, thickness = 1.dp)
      HealthStatusRow(title = "模型", value = models, healthy = modelsReady)
      HorizontalDivider(color = ClawTheme.colors.border, thickness = 1.dp)
      HealthStatusRow(title = "语音", value = voice, healthy = voiceReady)
      HorizontalDivider(color = ClawTheme.colors.border, thickness = 1.dp)
      HealthStatusRow(title = "运行", value = runs, healthy = true)
    }
  }
}

@Composable
private fun HealthStatusRow(
  title: String,
  value: String,
  healthy: Boolean,
) {
  Row(
    modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 7.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(9.dp),
  ) {
    Text(text = title, style = ClawTheme.type.body, color = ClawTheme.colors.text, modifier = Modifier.weight(1f), maxLines = 1)
    ClawStatusPill(text = value, status = if (healthy) ClawStatus.Success else ClawStatus.Warning)
  }
}

@Composable
private fun GatewayLogsPanel(
  isConnected: Boolean,
  summary: GatewayHealthLogsSummary,
) {
  Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
      Text(text = "RECENT LOGS", style = ClawTheme.type.caption, color = ClawTheme.colors.textMuted)
      summary.fileName?.let { fileName ->
        Text(text = fileName, style = ClawTheme.type.caption, color = ClawTheme.colors.textSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
    }
    when {
      !isConnected ->
        ClawPanel {
          Text(text = 连接网关以加载最近日志。", style = ClawTheme.type.body, color = ClawTheme.colors.textMuted)
        }
      summary.entries.isEmpty() ->
        ClawPanel {
          Text(text = 没有最近日志条目。", style = ClawTheme.type.body, color = ClawTheme.colors.textMuted)
        }
      else ->
        ClawPanel(contentPadding = PaddingValues(horizontal = 0.dp, vertical = 0.dp)) {
          val entries = summary.entries.takeLast(12)
          Column {
            entries.forEachIndexed { index, entry ->
              GatewayLogRow(entry = entry)
              if (index != entries.lastIndex) {
                HorizontalDivider(color = ClawTheme.colors.border, thickness = 1.dp)
              }
            }
          }
        }
    }
    if (summary.truncated) {
      Text(text = "Showing the latest log chunk.", style = ClawTheme.type.caption, color = ClawTheme.colors.textSubtle)
    }
  }
}

@Composable
private fun GatewayLogRow(entry: GatewayLogEntry) {
  Row(
    modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 7.dp),
    verticalAlignment = Alignment.Top,
    horizontalArrangement = Arrangement.spacedBy(9.dp),
  ) {
    Text(text = compactLogTime(entry.time), style = ClawTheme.type.caption, color = ClawTheme.colors.textSubtle, modifier = Modifier.weight(0.72f), maxLines = 1)
    Column(modifier = Modifier.weight(2.7f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
      Text(text = entry.message, style = ClawTheme.type.caption, color = ClawTheme.colors.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
      entry.subsystem?.let { subsystem ->
        Text(text = subsystem, style = ClawTheme.type.caption, color = ClawTheme.colors.textSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
    }
    ClawStatusPill(text = entry.level?.uppercase() ?: "日志", status = logLevelStatus(entry.level))
  }
}

private fun compactLogTime(value: String?): String {
  val raw = value?.trim().orEmpty()
  if (raw.isEmpty()) return "--:--"
  val time =
    raw
      .substringAfter('T', raw)
      .substringBefore('.')
      .substringBefore('+')
      .substringBefore('Z')
  return time.takeIf { it.length >= 5 }?.take(5) ?: raw.take(5)
}

private fun logLevelStatus(level: String?): ClawStatus =
  when (level?.lowercase()) {
    "error", "fatal" -> ClawStatus.Danger
    "warn" -> ClawStatus.Warning
    "info" -> ClawStatus.Success
    else -> ClawStatus.Neutral
  }
