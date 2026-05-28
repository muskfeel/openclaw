package ai.openclaw.app.ui

import ai.openclaw.app.MainViewModel
import ai.openclaw.app.VoiceCaptureMode
import ai.openclaw.app.ui.design.ClawPanel
import ai.openclaw.app.ui.design.ClawPrimaryButton
import ai.openclaw.app.ui.design.ClawSecondaryButton
import ai.openclaw.app.ui.design.ClawStatus
import ai.openclaw.app.ui.design.ClawStatusPill
import ai.openclaw.app.ui.design.ClawTheme
import ai.openclaw.app.voice.VoiceConversationEntry
import ai.openclaw.app.voice.VoiceConversationRole
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.PhoneDisabled
import androidx.compose.material.icons.filled.RecordVoiceOver
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat

@Composable
fun VoiceScreen(
  viewModel: MainViewModel,
  onOpenCommand: () -> Unit,
  onOpenGatewaySettings: () -> Unit,
  onOpenVoiceSettings: () -> Unit,
) {
  val context = LocalContext.current
  val gatewayStatus by viewModel.statusText.collectAsState()
  val voiceCaptureMode by viewModel.voiceCaptureMode.collectAsState()
  val micEnabled by viewModel.micEnabled.collectAsState()
  val micCooldown by viewModel.micCooldown.collectAsState()
  val speakerEnabled by viewModel.speakerEnabled.collectAsState()
  val micStatusText by viewModel.micStatusText.collectAsState()
  val micLiveTranscript by viewModel.micLiveTranscript.collectAsState()
  val micQueuedMessages by viewModel.micQueuedMessages.collectAsState()
  val micConversation by viewModel.micConversation.collectAsState()
  val micIsSending by viewModel.micIsSending.collectAsState()
  val talkModeEnabled by viewModel.talkModeEnabled.collectAsState()
  val talkModeListening by viewModel.talkModeListening.collectAsState()
  val talkModeSpeaking by viewModel.talkModeSpeaking.collectAsState()
  val talkModeConversation by viewModel.talkModeConversation.collectAsState()

  var pendingAction by remember { mutableStateOf<VoiceAction?>(null) }
  var hasMicPermission by remember { mutableStateOf(context.hasRecordAudioPermission()) }
  val requestMicPermission =
    rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      hasMicPermission = granted
      if (granted) {
        when (pendingAction) {
          VoiceAction.Talk -> viewModel.setTalkModeEnabled(true)
          VoiceAction.Dictation -> viewModel.setMicEnabled(true)
          null -> Unit
        }
      }
      pendingAction = null
    }

  val activeConversation = if (voiceCaptureMode == VoiceCaptureMode.TalkMode) talkModeConversation else micConversation
  val voiceActive = micEnabled || micIsSending || talkModeEnabled
  val gatewayReady = gatewayStatus.isVoiceGatewayReady()
  val activeStatus =
    voiceStatusLabel(
      gatewayStatus = gatewayStatus,
      voiceCaptureMode = voiceCaptureMode,
      micStatusText = micStatusText,
      micQueuedMessages = micQueuedMessages.size,
      micIsSending = micIsSending,
      talkModeListening = talkModeListening,
      talkModeSpeaking = talkModeSpeaking,
    )

  if (talkModeEnabled) {
    TalkSessionScreen(
      entries = talkModeConversation,
      listening = talkModeListening,
      speaking = talkModeSpeaking,
      speakerEnabled = speakerEnabled,
      onToggleSpeaker = { viewModel.setSpeakerEnabled(!speakerEnabled) },
      onEndTalk = { viewModel.setTalkModeEnabled(false) },
      onOpenVoiceSettings = onOpenVoiceSettings,
    )
    return
  }

  if (voiceCaptureMode == VoiceCaptureMode.ManualMic || micEnabled || micIsSending) {
    DictationScreen(
      liveTranscript = micLiveTranscript,
      conversation = micConversation,
      listening = micEnabled,
      sending = micIsSending,
      statusText = activeStatus,
      gatewayStatus = gatewayStatus,
      onCancel = { viewModel.cancelMicCapture() },
      onSend = { viewModel.setMicEnabled(false) },
      onOpenVoiceSettings = onOpenVoiceSettings,
    )
    return
  }

  Column(
    modifier =
      Modifier
        .fillMaxSize()
        .imePadding()
        .padding(horizontal = 20.dp, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    VoiceHeader(
      statusText = if (voiceActive || !gatewayReady) activeStatus else "Your voice command center.",
      speakerEnabled = speakerEnabled,
      onToggleSpeaker = { viewModel.setSpeakerEnabled(!speakerEnabled) },
      onOpenCommand = onOpenCommand,
    )

    VoiceHero(
      gatewayStatus = gatewayStatus,
      voiceCaptureMode = voiceCaptureMode,
      micEnabled = micEnabled,
      talkModeEnabled = talkModeEnabled,
      talkModeListening = talkModeListening,
      talkModeSpeaking = talkModeSpeaking,
      micLiveTranscript = micLiveTranscript,
      gatewayReady = gatewayReady,
      onStartTalk = {
        runVoiceAction(
          action = VoiceAction.Talk,
          hasMicPermission = hasMicPermission,
          requestPermission = {
            pendingAction = VoiceAction.Talk
            requestMicPermission.launch(Manifest.permission.RECORD_AUDIO)
          },
          run = { viewModel.setTalkModeEnabled(!talkModeEnabled) },
        )
      },
      onStartDictation = {
        if (micCooldown) return@VoiceHero
        runVoiceAction(
          action = VoiceAction.Dictation,
          hasMicPermission = hasMicPermission,
          requestPermission = {
            pendingAction = VoiceAction.Dictation
            requestMicPermission.launch(Manifest.permission.RECORD_AUDIO)
          },
          run = { viewModel.setMicEnabled(!micEnabled) },
        )
      },
      onConnectGateway = onOpenGatewaySettings,
    )

    if (!hasMicPermission) {
      VoicePermissionPanel(
        onRequestPermission = {
          pendingAction = VoiceAction.Talk
          requestMicPermission.launch(Manifest.permission.RECORD_AUDIO)
        },
      )
    }

    VoiceTranscript(
      entries = activeConversation,
      showThinking = micIsSending && activeConversation.none { it.role == VoiceConversationRole.Assistant && it.isStreaming },
      modifier = Modifier.weight(1f),
    )
  }
}

@Composable
private fun DictationScreen(
  liveTranscript: String?,
  conversation: List<VoiceConversationEntry>,
  listening: Boolean,
  sending: Boolean,
  statusText: String,
  gatewayStatus: String,
  onCancel: () -> Unit,
  onSend: () -> Unit,
  onOpenVoiceSettings: () -> Unit,
) {
  val lastUserText = conversation.lastOrNull { it.role == VoiceConversationRole.User }?.text
  val draftText = liveTranscript?.takeIf { it.isNotBlank() } ?: lastUserText.orEmpty()
  val speechProviderReady = gatewayStatus.isVoiceGatewayReady()
  Column(
    modifier =
      Modifier
        .fillMaxSize()
        .imePadding()
        .padding(horizontal = 20.dp, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
      VoicePlainIconButton(icon = Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回语音", onClick = onCancel)
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(text = "听写", style = ClawTheme.type.title.copy(fontSize = 16.sp, lineHeight = 20.sp), color = ClawTheme.colors.text)
        Text(text = "转写后发送", style = ClawTheme.type.body, color = ClawTheme.colors.textMuted)
      }
      VoicePlainIconButton(icon = Icons.Default.Settings, contentDescription = "听写设置", onClick = onOpenVoiceSettings)
    }

    Surface(
      modifier = Modifier.fillMaxWidth().aspectRatio(0.82f),
      shape = RoundedCornerShape(ClawTheme.radii.panel),
      color = ClawTheme.colors.canvas,
      border = BorderStroke(1.dp, ClawTheme.colors.borderStrong),
    ) {
      Column(modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 12.dp), verticalArrangement = Arrangement.SpaceBetween) {
        Text(
          text = draftText.ifBlank { if (sending) "Sending to chat..." else "Start speaking..." },
          style = ClawTheme.type.title.copy(fontSize = 15.sp, lineHeight = 19.sp),
          color = if (draftText.isBlank()) ClawTheme.colors.textSubtle else ClawTheme.colors.text,
          maxLines = 7,
          overflow = TextOverflow.Ellipsis,
        )
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
          DictationWaveform(active = listening || sending)
          Row(horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(imageVector = Icons.Default.Mic, contentDescription = null, modifier = Modifier.size(15.dp), tint = if (listening) ClawTheme.colors.success else ClawTheme.colors.textMuted)
            Text(text = statusText, style = ClawTheme.type.body, color = ClawTheme.colors.textMuted)
          }
        }
      }
    }

    ClawPanel(contentPadding = PaddingValues(horizontal = 10.dp, vertical = 8.dp)) {
      Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Surface(
          modifier = Modifier.size(30.dp),
          shape = CircleShape,
          color = ClawTheme.colors.surfacePressed,
          border = BorderStroke(1.dp, ClawTheme.colors.border),
        ) {
          Box(contentAlignment = Alignment.Center) {
            Icon(imageVector = Icons.Default.GraphicEq, contentDescription = null, modifier = Modifier.size(16.dp), tint = ClawTheme.colors.text)
          }
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
          Text(text = "语音提供商", style = ClawTheme.type.section, color = ClawTheme.colors.text)
          Text(text = gatewayStatus.voiceGatewayLabel(), style = ClawTheme.type.body, color = ClawTheme.colors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          Text(
            text =
              when {
                sending -> "发送中"
                speechProviderReady -> "就绪"
                else -> "离线"
              },
            style = ClawTheme.type.caption.copy(fontSize = 12.5.sp, lineHeight = 16.sp),
            color =
              when {
                sending -> ClawTheme.colors.warning
                speechProviderReady -> ClawTheme.colors.success
                else -> ClawTheme.colors.textMuted
              },
          )
          Box(
            modifier =
              Modifier
                .size(6.dp)
                .clip(CircleShape)
                .background(
                  when {
                    sending -> ClawTheme.colors.warning
                    speechProviderReady -> ClawTheme.colors.success
                    else -> ClawTheme.colors.textSubtle
                  },
                ),
          )
        }
      }
    }

    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      Icon(imageVector = Icons.Default.Info, contentDescription = null, modifier = Modifier.size(16.dp), tint = ClawTheme.colors.textMuted)
      Text(text = "Tip: stop listening to send the captured turn.", style = ClawTheme.type.caption, color = ClawTheme.colors.textMuted)
    }

    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      ClawSecondaryButton(text = "取消", icon = Icons.Default.Close, onClick = onCancel, modifier = Modifier.weight(0.95f))
      ClawPrimaryButton(text = if (sending) "发送中" else "发送到聊天", icon = Icons.AutoMirrored.Filled.Send, onClick = onSend, enabled = !sending, modifier = Modifier.weight(1.25f))
    }
  }
}

@Composable
private fun DictationWaveform(active: Boolean) {
  Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
    List(48) { index ->
      val height = if (active) 3 + ((index * 7) % 16) else 3 + (index % 3) * 2
      Box(
        modifier =
          Modifier
            .size(width = 2.dp, height = height.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(if (active) ClawTheme.colors.text else ClawTheme.colors.textSubtle),
      )
    }
  }
}

@Composable
private fun TalkSessionScreen(
  entries: List<VoiceConversationEntry>,
  listening: Boolean,
  speaking: Boolean,
  speakerEnabled: Boolean,
  onToggleSpeaker: () -> Unit,
  onEndTalk: () -> Unit,
  onOpenVoiceSettings: () -> Unit,
) {
  Column(
    modifier =
      Modifier
        .fillMaxSize()
        .imePadding()
        .padding(horizontal = 20.dp, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      VoicePlainIconButton(icon = Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回语音", onClick = onEndTalk)
      Column(modifier = Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(text = "实时对话", style = ClawTheme.type.title.copy(fontSize = 16.sp, lineHeight = 20.sp), color = ClawTheme.colors.text)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
          Box(modifier = Modifier.size(4.5.dp).clip(CircleShape).background(if (speaking || listening) ClawTheme.colors.success else ClawTheme.colors.textSubtle))
          Text(
            text =
              if (speaking) {
                "OpenClaw说话中"
              } else if (listening) {
                "实时语音"
              } else {
                "已连接"
              },
            style = ClawTheme.type.body,
            color = ClawTheme.colors.textMuted,
          )
        }
      }
      VoicePlainIconButton(icon = Icons.Default.Info, contentDescription = "对话设置", onClick = onOpenVoiceSettings)
    }

    Surface(
      modifier = Modifier.fillMaxWidth().height(52.dp),
      shape = RoundedCornerShape(ClawTheme.radii.panel),
      color = ClawTheme.colors.canvas,
      border = BorderStroke(1.dp, ClawTheme.colors.borderStrong),
    ) {
      Box(contentAlignment = Alignment.Center) {
        TalkWaveform(active = listening || speaking)
      }
    }

    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(text = "实时转录", style = ClawTheme.type.caption, color = ClawTheme.colors.textMuted)
      TalkTranscript(entries = entries, modifier = Modifier.weight(1f))
    }

    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.SpaceEvenly,
      verticalAlignment = Alignment.CenterVertically,
    ) {
      TalkControl(icon = if (speakerEnabled) Icons.AutoMirrored.Filled.VolumeUp else Icons.AutoMirrored.Filled.VolumeOff, label = if (speakerEnabled) "静音" else "取消静音", onClick = onToggleSpeaker)
      TalkControl(icon = Icons.Default.PhoneDisabled, label = "结束", primary = true, onClick = onEndTalk)
      TalkControl(icon = Icons.Default.GraphicEq, label = "语音", onClick = onOpenVoiceSettings)
    }
  }
}

@Composable
private fun TalkTranscript(
  entries: List<VoiceConversationEntry>,
  modifier: Modifier = Modifier,
) {
  LazyColumn(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    if (entries.isEmpty()) {
      item {
        TalkTranscriptCard(label = "OpenClaw", text = "Listening for your next turn.", muted = true)
      }
    } else {
      items(entries.takeLast(6), key = { it.id }) { entry ->
        TalkTranscriptCard(
          label = if (entry.role == VoiceConversationRole.User) "你" else "OpenClaw",
          text = if (entry.isStreaming && entry.text.isBlank()) "Listening response..." else entry.text,
          muted = entry.isStreaming,
        )
      }
    }
  }
}

@Composable
private fun TalkTranscriptCard(
  label: String,
  text: String,
  muted: Boolean = false,
) {
  Surface(
    modifier = Modifier.fillMaxWidth(),
    shape = RoundedCornerShape(ClawTheme.radii.panel),
    color = ClawTheme.colors.surface,
    border = BorderStroke(1.dp, ClawTheme.colors.border),
  ) {
    Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
      Text(text = label, style = ClawTheme.type.section, color = ClawTheme.colors.text)
      Text(text = text, style = ClawTheme.type.body, color = if (muted) ClawTheme.colors.textMuted else ClawTheme.colors.text)
    }
  }
}

@Composable
private fun TalkControl(
  icon: androidx.compose.ui.graphics.vector.ImageVector,
  label: String,
  primary: Boolean = false,
  onClick: () -> Unit,
) {
  Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp)) {
    Surface(
      onClick = onClick,
      modifier = Modifier.size(ClawTheme.spacing.touchTarget),
      shape = RoundedCornerShape(ClawTheme.radii.button),
      color = if (primary) ClawTheme.colors.primary else ClawTheme.colors.canvas,
      contentColor = if (primary) ClawTheme.colors.primaryText else ClawTheme.colors.text,
      border = BorderStroke(1.dp, if (primary) ClawTheme.colors.primary else ClawTheme.colors.border),
    ) {
      Box(contentAlignment = Alignment.Center) {
        Icon(imageVector = icon, contentDescription = label, modifier = Modifier.size(if (primary) 20.dp else 18.dp))
      }
    }
    Text(text = label, style = ClawTheme.type.caption.copy(fontSize = 12.5.sp, lineHeight = 16.sp), color = ClawTheme.colors.textMuted)
  }
}

@Composable
private fun TalkWaveform(active: Boolean) {
  Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
    listOf(4, 12, 24, 34, 46, 28, 12, 38, 44, 24, 12, 30, 42, 18, 6).forEachIndexed { index, height ->
      Box(
        modifier =
          Modifier
            .size(width = 3.dp, height = (if (active) height else 6 + index % 4 * 5).dp)
            .clip(RoundedCornerShape(999.dp))
            .background(if (active) ClawTheme.colors.text else ClawTheme.colors.textSubtle),
      )
    }
  }
}

@Composable
private fun VoiceHeader(
  statusText: String,
  speakerEnabled: Boolean,
  onToggleSpeaker: () -> Unit,
  onOpenCommand: () -> Unit,
) {
  Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Row(
      modifier = Modifier.fillMaxWidth(),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Text(
        text = "O P E N C L A W",
        style = ClawTheme.type.title.copy(fontSize = 18.sp, lineHeight = 23.sp),
        color = ClawTheme.colors.text,
        modifier = Modifier.weight(1f),
      )
      VoicePlainIconButton(icon = Icons.Default.Search, contentDescription = "搜索语音", onClick = onOpenCommand)
      VoiceAvatar(text = "OC")
    }
    Row(
      modifier = Modifier.fillMaxWidth(),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(text = "语音", style = ClawTheme.type.display.copy(fontSize = 16.sp, lineHeight = 20.sp), color = ClawTheme.colors.text)
        Text(
          text = statusText,
          style = ClawTheme.type.body,
          color = ClawTheme.colors.textMuted,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
      VoicePlainIconButton(
        icon = if (speakerEnabled) Icons.AutoMirrored.Filled.VolumeUp else Icons.AutoMirrored.Filled.VolumeOff,
        contentDescription = if (speakerEnabled) "静音扬声器" else "Unmute speaker",
        onClick = onToggleSpeaker,
      )
    }
  }
}

@Composable
private fun VoiceAvatar(text: String) {
  Surface(
    modifier = Modifier.size(34.dp),
    shape = CircleShape,
    color = ClawTheme.colors.surfaceRaised,
    contentColor = ClawTheme.colors.text,
    border = BorderStroke(1.dp, ClawTheme.colors.border),
  ) {
    Box(contentAlignment = Alignment.Center) {
      Text(text = text.take(2).uppercase(), style = ClawTheme.type.label)
    }
  }
}

@Composable
private fun VoicePlainIconButton(
  icon: androidx.compose.ui.graphics.vector.ImageVector,
  contentDescription: String,
  onClick: () -> Unit,
) {
  Surface(onClick = onClick, modifier = Modifier.size(ClawTheme.spacing.touchTarget), shape = CircleShape, color = Color.Transparent, contentColor = ClawTheme.colors.text) {
    Box(contentAlignment = Alignment.Center) {
      Icon(imageVector = icon, contentDescription = contentDescription, modifier = Modifier.size(18.dp))
    }
  }
}

@Composable
private fun VoiceHero(
  gatewayStatus: String,
  voiceCaptureMode: VoiceCaptureMode,
  micEnabled: Boolean,
  talkModeEnabled: Boolean,
  talkModeListening: Boolean,
  talkModeSpeaking: Boolean,
  micLiveTranscript: String?,
  gatewayReady: Boolean,
  onStartTalk: () -> Unit,
  onStartDictation: () -> Unit,
  onConnectGateway: () -> Unit,
) {
  Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(9.dp)) {
    VoiceOrb(
      active = micEnabled || talkModeEnabled,
      listening = talkModeListening || voiceCaptureMode == VoiceCaptureMode.ManualMic,
      speaking = talkModeSpeaking,
    )

    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Box(
        modifier =
          Modifier
            .size(7.dp)
            .clip(CircleShape)
            .background(if (micEnabled || talkModeEnabled) ClawTheme.colors.success else ClawTheme.colors.textSubtle),
      )
      Text(
        text =
          when {
            talkModeSpeaking -> "OpenClaw正在回复"
            talkModeListening -> "监听中"
            talkModeEnabled -> "对话正在进行"
            micEnabled -> "听写监听中"
            !gatewayReady -> "网关离线"
            else -> "准备对话"
          },
        style = ClawTheme.type.body,
        color = ClawTheme.colors.textMuted,
        textAlign = TextAlign.Center,
      )
    }

    if (!micLiveTranscript.isNullOrBlank()) {
      Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(ClawTheme.radii.panel),
        color = ClawTheme.colors.surface,
        border = BorderStroke(1.dp, ClawTheme.colors.borderStrong),
      ) {
        Text(
          text = micLiveTranscript.trim(),
          modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp),
          style = ClawTheme.type.body,
          color = ClawTheme.colors.text,
        )
      }
    }

    ClawPanel(contentPadding = PaddingValues(horizontal = 14.dp, vertical = 4.dp)) {
      VoiceModeRow(
        title = if (talkModeEnabled) "结束对话" else "实时对话",
        subtitle =
          when {
            talkModeEnabled -> "对话正在进行"
            gatewayReady -> "自然实时对话"
            else -> "连接网关以开始"
          },
        icon = if (talkModeEnabled) Icons.Default.PhoneDisabled else Icons.Default.RecordVoiceOver,
        onClick = onStartTalk,
        enabled = gatewayReady || talkModeEnabled,
      )
      VoiceModeRow(
        title = if (micEnabled) "停止听写" else "听写",
        subtitle =
          when {
            micEnabled -> "监听一轮"
            gatewayReady -> "将语音转换为文字"
            else -> "连接网关以开始"
          },
        icon = if (micEnabled) Icons.Default.MicOff else Icons.Default.TextFields,
        onClick = onStartDictation,
        enabled = gatewayReady || micEnabled,
      )
    }

    VoiceProviderCard(gatewayStatus = gatewayStatus)

    VoicePrimaryAction(
      text =
        when {
          talkModeEnabled -> "结束对话"
          gatewayReady -> "开始对话"
          else -> "连接网关"
        },
      icon =
        when {
          talkModeEnabled -> Icons.Default.PhoneDisabled
          gatewayReady -> Icons.Default.Phone
          else -> Icons.Default.Cloud
        },
      onClick = if (gatewayReady || talkModeEnabled) onStartTalk else onConnectGateway,
    )
  }
}

@Composable
private fun VoiceModeRow(
  title: String,
  subtitle: String,
  icon: androidx.compose.ui.graphics.vector.ImageVector,
  onClick: () -> Unit,
  enabled: Boolean = true,
) {
  Surface(onClick = onClick, enabled = enabled, color = Color.Transparent, contentColor = ClawTheme.colors.text) {
    Row(
      modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp).padding(horizontal = 0.dp, vertical = 7.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Surface(
        modifier = Modifier.size(30.dp),
        shape = RoundedCornerShape(ClawTheme.radii.control),
        color = if (enabled) ClawTheme.colors.surface else ClawTheme.colors.canvas,
        contentColor = if (enabled) ClawTheme.colors.text else ClawTheme.colors.textSubtle,
        border = BorderStroke(1.dp, ClawTheme.colors.border),
      ) {
        Box(contentAlignment = Alignment.Center) {
          Icon(imageVector = icon, contentDescription = null, modifier = Modifier.size(15.dp))
        }
      }
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(text = title, style = ClawTheme.type.body, color = if (enabled) ClawTheme.colors.text else ClawTheme.colors.textMuted, maxLines = 1)
        Text(text = subtitle, style = ClawTheme.type.caption.copy(fontSize = 12.5.sp, lineHeight = 16.sp), color = ClawTheme.colors.textMuted, maxLines = 1)
      }
      if (enabled) {
        Icon(
          imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
          contentDescription = null,
          modifier = Modifier.size(18.dp),
          tint = ClawTheme.colors.textMuted,
        )
      }
    }
  }
}

@Composable
private fun VoiceProviderCard(gatewayStatus: String) {
  val ready = gatewayStatus.isVoiceGatewayReady()
  Surface(
    modifier = Modifier.fillMaxWidth().heightIn(min = 58.dp),
    shape = RoundedCornerShape(ClawTheme.radii.panel),
    color = ClawTheme.colors.surface,
    contentColor = ClawTheme.colors.text,
    border = BorderStroke(1.dp, ClawTheme.colors.border),
  ) {
    Row(
      modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 9.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Surface(
        modifier = Modifier.size(30.dp),
        shape = RoundedCornerShape(ClawTheme.radii.control),
        color = ClawTheme.colors.canvas,
        contentColor = ClawTheme.colors.text,
        border = BorderStroke(1.dp, ClawTheme.colors.borderStrong),
      ) {
        Box(contentAlignment = Alignment.Center) {
          Icon(imageVector = Icons.Default.GraphicEq, contentDescription = null, modifier = Modifier.size(15.dp))
        }
      }
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(text = "提供商", style = ClawTheme.type.body, color = ClawTheme.colors.text, maxLines = 1)
        Text(text = gatewayStatus.voiceGatewayLabel(), style = ClawTheme.type.caption, color = ClawTheme.colors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        Box(
          modifier =
            Modifier
              .size(7.dp)
              .clip(CircleShape)
              .background(if (ready) ClawTheme.colors.success else ClawTheme.colors.textSubtle),
        )
        Text(text = if (ready) "就绪" else "离线", style = ClawTheme.type.caption, color = ClawTheme.colors.textMuted, maxLines = 1)
      }
    }
  }
}

@Composable
private fun VoicePrimaryAction(
  text: String,
  icon: androidx.compose.ui.graphics.vector.ImageVector,
  onClick: () -> Unit,
) {
  Surface(
    onClick = onClick,
    modifier = Modifier.fillMaxWidth().height(ClawTheme.spacing.touchTarget),
    shape = RoundedCornerShape(ClawTheme.radii.button),
    color = ClawTheme.colors.primary,
    contentColor = ClawTheme.colors.primaryText,
  ) {
    Row(
      modifier = Modifier.fillMaxSize(),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.Center,
    ) {
      Icon(imageVector = icon, contentDescription = null, modifier = Modifier.size(17.dp))
      Text(text = text, modifier = Modifier.padding(start = 8.dp), style = ClawTheme.type.label)
    }
  }
}

@Composable
private fun VoiceOrb(
  active: Boolean,
  listening: Boolean,
  speaking: Boolean,
) {
  Surface(
    modifier = Modifier.size(112.dp),
    shape = CircleShape,
    color = if (active) ClawTheme.colors.surfacePressed else ClawTheme.colors.surface,
    border = BorderStroke(1.dp, if (active) ClawTheme.colors.borderStrong else ClawTheme.colors.border),
  ) {
    Box(contentAlignment = Alignment.Center) {
      Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(
          imageVector =
            when {
              speaking -> Icons.Default.RecordVoiceOver
              listening -> Icons.Default.GraphicEq
              else -> Icons.Default.Mic
            },
          contentDescription = null,
          modifier = Modifier.size(32.dp),
          tint = ClawTheme.colors.text,
        )
        Waveform(active = active)
      }
    }
  }
}

@Composable
private fun Waveform(active: Boolean) {
  Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
    listOf(6, 11, 17, 23, 14, 9, 20, 14, 7).forEachIndexed { index, height ->
      Box(
        modifier =
          Modifier
            .size(width = 2.dp, height = (if (active) height else 6 + index % 3 * 3).dp)
            .clip(RoundedCornerShape(999.dp))
            .background(if (active) ClawTheme.colors.text else ClawTheme.colors.textSubtle),
      )
    }
  }
}

@Composable
private fun VoiceTranscript(
  entries: List<VoiceConversationEntry>,
  showThinking: Boolean,
  modifier: Modifier = Modifier,
) {
  val listState = rememberLazyListState()
  LaunchedEffect(entries.size, showThinking) {
    if (entries.isNotEmpty() || showThinking) {
      listState.animateScrollToItem(0)
    }
  }

  LazyColumn(
    modifier = modifier.fillMaxWidth(),
    state = listState,
    reverseLayout = true,
    verticalArrangement = Arrangement.spacedBy(10.dp),
    contentPadding = PaddingValues(bottom = 8.dp),
  ) {
    if (showThinking) {
      item(key = "thinking") {
        VoiceThinkingCard()
      }
    }

    items(entries.asReversed(), key = { it.id }) { entry ->
      VoiceTurnCard(entry = entry)
    }

    if (entries.isEmpty() && !showThinking) {
      item {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Text(text = "实时转录", style = ClawTheme.type.caption, color = ClawTheme.colors.textSubtle)
          ClawPanel(contentPadding = PaddingValues(horizontal = 14.dp, vertical = 9.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
              Text(text = "还没有转录", style = ClawTheme.type.section, color = ClawTheme.colors.text)
              Text(
                text = "Your words and OpenClaw replies will appear here.",
                style = ClawTheme.type.body,
                color = ClawTheme.colors.textMuted,
              )
            }
          }
        }
      }
    }
  }
}

@Composable
private fun VoiceTurnCard(entry: VoiceConversationEntry) {
  val isUser = entry.role == VoiceConversationRole.User
  Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start) {
    Surface(
      modifier = Modifier.fillMaxWidth(if (isUser) 0.82f else 0.92f),
      shape = RoundedCornerShape(ClawTheme.radii.panel),
      color = if (isUser) ClawTheme.colors.surfacePressed else ClawTheme.colors.surfaceRaised,
      contentColor = ClawTheme.colors.text,
      border = BorderStroke(1.dp, if (entry.isStreaming) ClawTheme.colors.borderStrong else ClawTheme.colors.border),
    ) {
      Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(
          text = if (isUser) "你" else "OpenClaw",
          style = ClawTheme.type.caption.copy(fontSize = 12.5.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold),
          color = ClawTheme.colors.textSubtle,
        )
        Text(
          text = if (entry.isStreaming && entry.text.isBlank()) "监听中..." else entry.text,
          style = ClawTheme.type.body,
          color = ClawTheme.colors.text,
        )
      }
    }
  }
}

@Composable
private fun VoiceThinkingCard() {
  ClawPanel {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      ClawStatusPill(text = "发送中", status = ClawStatus.Warning)
      Text(text = "OpenClaw is preparing a response.", style = ClawTheme.type.body, color = ClawTheme.colors.textMuted)
    }
  }
}

@Composable
private fun VoicePermissionPanel(onRequestPermission: () -> Unit) {
  ClawPanel {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
      ClawStatusPill(text = "需要权限", status = ClawStatus.Warning)
      Text(text = "Microphone access is needed.", style = ClawTheme.type.section, color = ClawTheme.colors.text)
      Text(
        text = "OpenClaw only listens when you start Talk or Dictation.",
        style = ClawTheme.type.body,
        color = ClawTheme.colors.textMuted,
      )
      ClawSecondaryButton(text = "启用麦克风", icon = Icons.Default.Mic, onClick = onRequestPermission)
    }
  }
}

private enum class VoiceAction {
  Talk,
  Dictation,
}

private fun runVoiceAction(
  action: VoiceAction,
  hasMicPermission: Boolean,
  requestPermission: () -> Unit,
  run: () -> Unit,
) {
  if (hasMicPermission) {
    run()
  } else {
    requestPermission()
  }
}

private fun voiceStatusLabel(
  gatewayStatus: String,
  voiceCaptureMode: VoiceCaptureMode,
  micStatusText: String,
  micQueuedMessages: Int,
  micIsSending: Boolean,
  talkModeListening: Boolean,
  talkModeSpeaking: Boolean,
): String =
  when {
    voiceCaptureMode == VoiceCaptureMode.TalkMode && talkModeSpeaking -> "OpenClaw正在说话"
    voiceCaptureMode == VoiceCaptureMode.TalkMode && talkModeListening -> "监听中"
    voiceCaptureMode == VoiceCaptureMode.TalkMode -> "对话正在进行"
    micIsSending -> "发送听写"
    voiceCaptureMode == VoiceCaptureMode.ManualMic -> micStatusText.ifBlank { "监听中" }
    micQueuedMessages > 0 -> "$micQueuedMessages queued"
    !gatewayStatus.isVoiceGatewayReady() -> "网关离线"
    else -> "准备对话"
  }

private fun String.isVoiceGatewayReady(): Boolean {
  val status = lowercase()
  return !status.contains("offline") && !status.contains("not connected") && !status.contains("failed") && !status.contains("error")
}

private fun String.voiceGatewayLabel(): String = if (isVoiceGatewayReady()) "已连接并就绪" else "网关未连接"

private fun Context.hasRecordAudioPermission(): Boolean = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
