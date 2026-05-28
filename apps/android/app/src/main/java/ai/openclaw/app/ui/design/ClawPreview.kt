package ai.openclaw.app.ui.design

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.res.stringResource
import ai.openclaw.app.R

@Preview(
  name = "OpenClaw Design System",
  showBackground = true,
  backgroundColor = 0xFF030303,
)
@Composable
private fun ClawComponentShowcasePreview() {
  ClawDesignTheme {
    ClawComponentShowcase()
  }
}
