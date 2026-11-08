package com.apexoffice.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.windowsizeclass.WindowWidthSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.apexoffice.android.AppKind
import com.apexoffice.android.RecentFile
import java.text.DateFormat
import java.util.Date

private enum class Destination(val label: String, val glyph: String) {
    Home("Home", "⌂"),
    Recent("Recent", "⧖"),
    About("About", "ⓘ"),
}

private fun AppKind.color(): Color = when (this) {
    AppKind.DOCS -> KindColors.docs
    AppKind.SHEETS -> KindColors.sheets
    AppKind.SLIDES -> KindColors.slides
    AppKind.PDF -> KindColors.pdf
    AppKind.MARKDOWN -> KindColors.markdown
    AppKind.HTML -> KindColors.html
}

/**
 * Adaptive shell. Phone (compact): bottom bar and a single column. Tablet portrait
 * (medium): a navigation rail and a wider grid. Tablet landscape / large (expanded):
 * rail plus two panes (editors | recent files) side by side, like the desktop home.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApexApp(
    widthClass: WindowWidthSizeClass,
    recents: List<RecentFile>,
    openDocument: RecentFile?,
    onPickFile: () -> Unit,
    onOpenRecent: (RecentFile) -> Unit,
    onRemoveRecent: (RecentFile) -> Unit,
    onCloseDocument: () -> Unit,
) {
    var destination by remember { mutableStateOf(Destination.Home) }
    BackHandler(enabled = openDocument != null && openDocument.kind != AppKind.SHEETS && openDocument.kind != AppKind.PDF) { onCloseDocument() }

    if (openDocument != null) {
        if (openDocument.kind == AppKind.SHEETS) {
            SheetsScreen(android.net.Uri.parse(openDocument.uri), openDocument.name, onCloseDocument)
        } else if (openDocument.kind == AppKind.PDF) {
            PdfScreen(android.net.Uri.parse(openDocument.uri), openDocument.name, onCloseDocument)
        } else {
            DocumentPlaceholder(openDocument, onCloseDocument)
        }
        return
    }

    val content: @Composable (Modifier) -> Unit = { modifier ->
        Box(modifier) {
            when (destination) {
                Destination.Home ->
                    if (widthClass == WindowWidthSizeClass.Expanded) {
                        Row(Modifier.fillMaxSize()) {
                            HomePane(Modifier.weight(1.3f), columns = 3, onPickFile = onPickFile)
                            HorizontalDividerVertical()
                            RecentPane(Modifier.weight(1f), recents, onOpenRecent, onRemoveRecent)
                        }
                    } else {
                        HomePane(
                            Modifier.fillMaxSize(),
                            columns = if (widthClass == WindowWidthSizeClass.Medium) 3 else 2,
                            onPickFile = onPickFile,
                        )
                    }
                Destination.Recent -> RecentPane(Modifier.fillMaxSize(), recents, onOpenRecent, onRemoveRecent)
                Destination.About -> AboutPane(Modifier.fillMaxSize())
            }
        }
    }

    if (widthClass == WindowWidthSizeClass.Compact) {
        Scaffold(
            bottomBar = {
                NavigationBar {
                    for (d in Destination.entries) {
                        NavigationBarItem(
                            selected = destination == d,
                            onClick = { destination = d },
                            icon = { Text(d.glyph, style = MaterialTheme.typography.titleLarge) },
                            label = { Text(d.label) },
                        )
                    }
                }
            },
        ) { padding -> content(Modifier.padding(padding).fillMaxSize()) }
    } else {
        Row(Modifier.fillMaxSize().statusBarsPadding()) {
            NavigationRail {
                Spacer(Modifier.height(12.dp))
                for (d in Destination.entries) {
                    NavigationRailItem(
                        selected = destination == d,
                        onClick = { destination = d },
                        icon = { Text(d.glyph, style = MaterialTheme.typography.titleLarge) },
                        label = { Text(d.label) },
                    )
                }
            }
            content(Modifier.weight(1f).fillMaxHeight())
        }
    }
}

@Composable
private fun HorizontalDividerVertical() {
    Box(Modifier.fillMaxHeight().size(1.dp).background(MaterialTheme.colorScheme.surfaceVariant))
}

@Composable
private fun Header(title: String, subtitle: String? = null) {
    Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) {
        Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
        if (subtitle != null) {
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.secondary)
        }
    }
}

@Composable
private fun HomePane(modifier: Modifier, columns: Int, onPickFile: () -> Unit) {
    Column(modifier.statusBarsPaddingIfCompact()) {
        Header("Apex Office", "Docs, sheets, slides and PDF, on this device")
        LazyVerticalGrid(
            columns = GridCells.Fixed(columns),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.weight(1f),
        ) {
            items(AppKind.entries) { kind -> KindCard(kind, onPickFile) }
        }
        Button(
            onClick = onPickFile,
            modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp),
            shape = RoundedCornerShape(14.dp),
        ) { Text("Open a file") }
    }
}

@Composable
private fun Modifier.statusBarsPaddingIfCompact(): Modifier = this.statusBarsPadding()

@Composable
private fun KindCard(kind: AppKind, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
        border = BorderStroke(1.dp, kind.color().copy(alpha = 0.35f)),
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier.size(44.dp).background(kind.color(), RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center,
            ) { Text(kind.title.first().toString(), color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
            Text(kind.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(kind.extensionHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
        }
    }
}

@Composable
private fun RecentPane(
    modifier: Modifier,
    recents: List<RecentFile>,
    onOpen: (RecentFile) -> Unit,
    onRemove: (RecentFile) -> Unit,
) {
    Column(modifier.statusBarsPadding()) {
        Header("Recent", if (recents.isEmpty()) null else "${recents.size} files")
        if (recents.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                Text("No recent files. Open one to see it here.", color = MaterialTheme.colorScheme.secondary)
            }
        } else {
            LazyColumn(Modifier.fillMaxSize()) {
                items(recents, key = { it.uri }) { file ->
                    RecentRow(file, onOpen = { onOpen(file) }, onRemove = { onRemove(file) })
                    HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun RecentRow(file: RecentFile, onOpen: () -> Unit, onRemove: () -> Unit) {
    val kind = file.kind
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier.size(38.dp).background(kind?.color() ?: Color.Gray, CircleShape),
            contentAlignment = Alignment.Center,
        ) { Text((kind?.title ?: "?").first().toString(), color = Color.White, fontWeight = FontWeight.Bold) }
        Column(Modifier.weight(1f)) {
            Text(file.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1)
            Text(
                DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(file.openedAt)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.secondary,
            )
        }
        TextButton(onClick = onRemove) { Text("Remove") }
    }
}

@Composable
private fun AboutPane(modifier: Modifier) {
    Column(modifier.statusBarsPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Header("About")
        Surface(
            tonalElevation = 2.dp,
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.widthIn(max = 560.dp).fillMaxWidth(),
        ) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Apex Office for Android", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text("Version 0.3.0 (stage 3: PDF)", style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(8.dp))
                Text("App developed by Mr. Falguni Bharadwaj", style = MaterialTheme.typography.bodyLarge)
                Spacer(Modifier.height(8.dp))
                Text(
                    "Everything stays on this device. Editors arrive in stages: Sheets, PDF with signatures, Docs, then Slides, Markdown and HTML.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.secondary,
                )
            }
        }
    }
}

@Composable
private fun DocumentPlaceholder(file: RecentFile, onClose: () -> Unit) {
    val kind = file.kind
    Column(
        Modifier.fillMaxSize().statusBarsPadding().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(file.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        Text(
            if (kind == null) "This file type is not supported yet."
            else "${kind.title} opens this file. The ${kind.title} editor arrives in stage ${kind.stage}.",
            color = MaterialTheme.colorScheme.secondary,
        )
        Spacer(Modifier.height(20.dp))
        OutlinedButton(onClick = onClose) { Text("Back") }
    }
}
