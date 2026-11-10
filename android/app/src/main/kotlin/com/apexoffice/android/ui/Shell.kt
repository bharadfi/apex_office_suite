package com.apexoffice.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** Dark chrome shared by every reader, as in the mockups: a top bar and a bottom action bar. */
private val Chrome = Color(0xFF202124)
private val OnChrome = Color(0xFFE8EAED)

@Composable
fun ReaderTopBar(title: String, subtitle: String?, onBack: () -> Unit, actions: @Composable RowScope.() -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().background(Chrome).padding(horizontal = 4.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.height(48.dp).width(48.dp).clickable(onClick = onBack), contentAlignment = Alignment.Center) {
            Text("‹", color = OnChrome, style = MaterialTheme.typography.headlineMedium)
        }
        Column(Modifier.weight(1f).padding(horizontal = 4.dp)) {
            Text(title, color = OnChrome, maxLines = 1, style = MaterialTheme.typography.titleMedium, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, color = OnChrome.copy(alpha = 0.7f), style = MaterialTheme.typography.bodySmall, maxLines = 1)
        }
        actions()
    }
}

@Composable
fun BarAction(glyph: String, label: String, onClick: () -> Unit, enabled: Boolean = true) {
    Box(
        Modifier.height(48.dp).width(48.dp).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(glyph, color = if (enabled) OnChrome else OnChrome.copy(alpha = 0.35f), style = MaterialTheme.typography.titleLarge) }
}

class BottomItem(val glyph: String, val label: String, val selected: Boolean = false, val enabled: Boolean = true, val onClick: () -> Unit)

@Composable
fun ReaderBottomBar(items: List<BottomItem>) {
    Row(Modifier.fillMaxWidth().background(Chrome).padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceAround) {
        for (item in items) {
            val tint = if (!item.enabled) OnChrome.copy(alpha = 0.35f) else if (item.selected) Color(0xFF8DD4B1) else OnChrome
            Column(
                Modifier.weight(1f).clickable(enabled = item.enabled, onClick = item.onClick).padding(vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(item.glyph, color = tint, style = MaterialTheme.typography.titleLarge)
                Text(item.label, color = tint, style = MaterialTheme.typography.labelSmall, maxLines = 1, textAlign = TextAlign.Center)
            }
        }
    }
}

/** The "Tools" sheet: tabs along the top (like the desktop ribbon tabs), grouped controls below. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ToolsSheet(tabs: List<String>, selected: String, onSelect: (String) -> Unit, onDismiss: () -> Unit, content: @Composable (String) -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
        containerColor = Color(0xFF1B1C1E),
        contentColor = OnChrome,
    ) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            for (tab in tabs) {
                val on = tab == selected
                Column(Modifier.clickable { onSelect(tab) }.padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(tab, color = if (on) Color.White else OnChrome.copy(alpha = 0.7f), fontWeight = if (on) FontWeight.Bold else FontWeight.Normal, style = MaterialTheme.typography.titleMedium)
                    Box(Modifier.height(3.dp).width(28.dp).background(if (on) Color(0xFF8DD4B1) else Color.Transparent))
                }
            }
        }
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp).padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) { content(selected) }
    }
}

@Composable
fun ToolGroup(title: String, content: @Composable () -> Unit) {
    Text(title, color = OnChrome.copy(alpha = 0.7f), style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(start = 6.dp, top = 8.dp))
    Column(Modifier.fillMaxWidth().background(Color(0xFF2A2B2E), RoundedCornerShape(16.dp)).padding(8.dp)) { content() }
}

/** A row of equally spaced tool buttons. */
@Composable
fun ToolRow(content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.Top, content = content)
}

@Composable
fun RowScope.ToolButton(glyph: String, label: String, enabled: Boolean = true, active: Boolean = false, onClick: () -> Unit) {
    val tint = if (!enabled) OnChrome.copy(alpha = 0.35f) else if (active) Color(0xFF8DD4B1) else OnChrome
    Column(
        Modifier.weight(1f).clickable(enabled = enabled, onClick = onClick).padding(vertical = 10.dp, horizontal = 2.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(glyph, color = tint, style = MaterialTheme.typography.headlineSmall)
        Text(label, color = tint, style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.Center, maxLines = 2)
    }
}

/** One labelled line inside a group (label left, control right). */
@Composable
fun ToolLine(label: String, onClick: (() -> Unit)? = null, trailing: @Composable () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 10.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = OnChrome, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        trailing()
    }
}
