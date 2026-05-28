package ai.openclaw.app.ui

import ai.openclaw.app.MainViewModel
import ai.openclaw.app.ui.chat.ChatSheetContent
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import ai.openclaw.app.R

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}
