package com.apexoffice.android.pdf

import com.tom_roush.pdfbox.cos.COSArray
import com.tom_roush.pdfbox.cos.COSBase
import com.tom_roush.pdfbox.cos.COSDictionary
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.cos.COSObject
import com.tom_roush.pdfbox.cos.COSStream
import com.tom_roush.pdfbox.cos.COSString
import com.tom_roush.pdfbox.pdmodel.PDDocument
import java.security.MessageDigest

/**
 * What may be written after a signature without breaking it, as other readers judge it (the same
 * rules as the desktop app): later revisions that only add signatures, validation data or the
 * bookkeeping that carries them are not changes; anything else is. A certifying signature narrows
 * this: level 1 allows nothing, level 2 also form filling, level 3 also annotations.
 */
object Revisions {
    private val ANNOTS = setOf(
        "Text", "FreeText", "Line", "Square", "Circle", "Polygon", "PolyLine", "Highlight", "Underline",
        "Squiggly", "StrikeOut", "Stamp", "Caret", "Ink", "Popup", "FileAttachment", "Redact", "Link",
    )

    private fun key(o: COSObject) = "${o.objectNumber} ${o.generationNumber}"

    private fun deref(b: COSBase?): COSBase? = if (b is COSObject) b.getObject() else b

    private fun dictOf(b: COSBase?): COSDictionary? = deref(b) as? COSDictionary

    private fun typeOf(b: COSBase?): String? = dictOf(b)?.getNameAsString(COSName.TYPE)

    /** A comparable form of an object; references stay as references, stream data is hashed */
    private fun repr(b: COSBase?): String = when (b) {
        null -> "null"
        is COSObject -> "${key(b)} R"
        is COSStream -> {
            val data = try { b.createRawInputStream().use { it.readBytes() } } catch (e: Exception) { ByteArray(0) }
            dictRepr(b) + "#" + MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }
        }
        is COSDictionary -> dictRepr(b)
        is COSArray -> b.toList().joinToString(",", "[", "]") { repr(it) }
        is COSString -> "(" + b.bytes.joinToString("") { "%02x".format(it) } + ")"
        else -> b.toString()
    }

    private fun dictRepr(d: COSDictionary): String =
        d.keySet().map { it.name }.sorted().joinToString(",", "<<", ">>") { k -> k + "=" + repr(d.getItem(COSName.getPDFName(k))) }

    private fun sameExcept(a: COSDictionary, b: COSDictionary, except: Set<String>): Boolean {
        val keys = (a.keySet() + b.keySet()).map { it.name }.toSet() - except
        return keys.all { k ->
            val n = COSName.getPDFName(k)
            val x = a.getItem(n)
            val y = b.getItem(n)
            x != null && y != null && repr(x) == repr(y)
        }
    }

    private fun objects(doc: PDDocument): Map<String, COSBase?> {
        val cos = doc.document
        val out = HashMap<String, COSBase?>()
        for (k in cos.xrefTable.keys) {
            val o = try { cos.getObjectFromPool(k) } catch (e: Exception) { continue }
            out["${k.number} ${k.generation}"] = try { o.getObject() } catch (e: Exception) { null }
        }
        return out
    }

    private fun reachable(start: COSBase?, finalObjs: Map<String, COSBase?>, into: MutableSet<String>) {
        fun visit(n: COSBase?, depth: Int) {
            if (n == null || depth > 24) return
            if (n is COSObject) {
                val k = key(n)
                if (k in into) return
                val target = finalObjs[k] ?: n.getObject()
                val t = typeOf(target)
                if (t == "Page" || t == "Pages") return
                into.add(k)
                visit(target, depth + 1)
                return
            }
            if (n is COSArray) { n.toList().forEach { visit(it, depth + 1) }; return }
            if (n is COSDictionary) {
                for (name in n.keySet()) {
                    if (name.name in setOf("P", "Parent", "Prev", "Next")) continue
                    visit(n.getItem(name), depth + 1)
                }
            }
        }
        visit(start, 0)
    }

    private fun fieldType(d: COSDictionary): String? {
        var cur: COSDictionary? = d
        var depth = 0
        while (cur != null && depth++ < 16) {
            cur.getNameAsString(COSName.FT)?.let { return it }
            cur = dictOf(cur.getItem(COSName.PARENT))
        }
        return null
    }

    private fun isSigValue(b: COSBase?): Boolean {
        val d = dictOf(b) ?: return false
        val t = d.getNameAsString(COSName.TYPE)
        return t == "Sig" || t == "DocTimeStamp" || (d.containsKey(COSName.BYTERANGE) && d.containsKey(COSName.CONTENTS))
    }

    private fun refs(b: COSBase?): List<COSBase> = (deref(b) as? COSArray)?.toList()?.filterNotNull() ?: emptyList()

    private fun refKey(b: COSBase): String? = (b as? COSObject)?.let { key(it) }

    /** The certification level (1 to 3) of the DocMDP signature that starts with `byteRangeStart`, or null */
    fun certifiedLevel(finalDoc: PDDocument, signatureContentsStart: Long): Int? = try {
        val perms = dictOf(finalDoc.documentCatalog.cosObject.getItem(COSName.getPDFName("Perms")))
        val sig = dictOf(perms?.getItem(COSName.getPDFName("DocMDP")))
        val range = sig?.getDictionaryObject(COSName.BYTERANGE) as? COSArray
        if (sig == null || range == null || range.getInt(1).toLong() != signatureContentsStart) null
        else {
            val ref = (sig.getDictionaryObject(COSName.getPDFName("Reference")) as? COSArray)?.getObject(0) as? COSDictionary
            val params = ref?.getDictionaryObject(COSName.getPDFName("TransformParams")) as? COSDictionary
            (params?.getInt(COSName.P, 2) ?: 2).coerceIn(1, 3)
        }
    } catch (e: Exception) { null }

    /** Whether every change made after `signedEnd` is one the signature allows */
    fun onlyPermittedChangesAfter(bytes: ByteArray, signedEnd: Int, finalDoc: PDDocument, level: Int?): Boolean {
        val base = try { PDDocument.load(bytes.copyOfRange(0, signedEnd)) } catch (e: Exception) { return false }
        base.use {
            val fin = objects(finalDoc)
            val old = objects(base)
            val changed = fin.keys.filter { k -> k !in old || repr(fin[k]) != repr(old[k]) }
            if (changed.isEmpty()) return bytes.copyOfRange(signedEnd, bytes.size).all { it.toInt().toChar().isWhitespace() }

            val catalog = finalDoc.documentCatalog.cosObject
            val acroEntry = catalog.getItem(COSName.ACRO_FORM)
            val allowed = HashSet<String>()
            val widgets = HashSet<String>()
            if (level != 1) reachable(catalog.getItem(COSName.getPDFName("DSS")), fin, allowed)

            for (k in changed) {
                val obj = fin[k]
                val d = dictOf(obj) ?: continue
                val isWidget = d.getNameAsString(COSName.SUBTYPE) == "Widget"
                val ft = if (isWidget || d.containsKey(COSName.FT)) fieldType(d) else null
                if (level == 1) continue
                if (ft == "Sig" || isSigValue(obj)) {
                    allowed.add(k); if (ft == "Sig") widgets.add(k)
                    reachable(obj, fin, allowed)
                } else if (level != null && level >= 2 && (isWidget || ft != null)) {
                    allowed.add(k); reachable(obj, fin, allowed)
                } else if (level == 3 && d.getNameAsString(COSName.SUBTYPE) in ANNOTS) {
                    allowed.add(k); widgets.add(k); reachable(obj, fin, allowed)
                }
            }

            val rootKey = (finalDoc.document.trailer.getItem(COSName.ROOT) as? COSObject)?.let { key(it) }
            val infoKey = (finalDoc.document.trailer.getItem(COSName.INFO) as? COSObject)?.let { key(it) }
            val annotArrays = HashSet<String>()
            for (o in fin.values) {
                if (typeOf(o) != "Page") continue
                refKey(dictOf(o)!!.getItem(COSName.ANNOTS) ?: continue)?.let { annotArrays.add(it) }
            }

            fun acroOk(before: COSDictionary, now: COSDictionary): Boolean {
                if (!sameExcept(before, now, setOf("Fields", "SigFlags", "DR", "DA", "NeedAppearances"))) return false
                val was = refs(before.getItem(COSName.FIELDS)).map { repr(it) }
                val fields = refs(now.getItem(COSName.FIELDS))
                if (!was.all { w -> fields.any { repr(it) == w } }) return false
                return fields.all { f -> repr(f) in was || refKey(f)?.let { it in widgets || it in allowed } == true }
            }

            for (k in changed) {
                val now = fin[k]
                val t = typeOf(now)
                if (t == "XRef" || t == "ObjStm" || k in allowed || k == infoKey) continue
                if (level != 1 && t == "Metadata") continue
                val before = old[k]
                if (k in annotArrays && now is COSArray && before is COSArray) {
                    if (level == 1) return false
                    val was = before.toList().map { repr(it) }
                    val items = now.toList()
                    if (!was.all { w -> items.any { repr(it) == w } }) return false
                    if (!items.all { repr(it) in was || refKey(it!!)?.let { r -> r in widgets } == true }) return false
                    continue
                }
                val nd = now as? COSDictionary
                val bd = before as? COSDictionary
                if (nd == null || bd == null || level == 1) return false
                if (k == rootKey || t == "Catalog") {
                    if (!sameExcept(bd, nd, setOf("AcroForm", "DSS", "Extensions", "Version"))) return false
                    val a = acroEntry
                    if (a is COSDictionary) {
                        val was = bd.getItem(COSName.ACRO_FORM)
                        if (was is COSDictionary) { if (!acroOk(was, a)) return false } else if (repr(was) != repr(a)) return false
                    }
                    continue
                }
                if (acroEntry is COSObject && k == key(acroEntry)) { if (!acroOk(bd, nd)) return false; continue }
                if (t == "Page") {
                    if (!sameExcept(bd, nd, setOf("Annots"))) return false
                    val was = refs(bd.getItem(COSName.ANNOTS)).map { repr(it) }
                    val items = refs(nd.getItem(COSName.ANNOTS))
                    if (!was.all { w -> items.any { repr(it) == w } }) return false
                    if (!items.all { repr(it) in was || refKey(it)?.let { r -> r in widgets } == true }) return false
                    continue
                }
                return false
            }
            return true
        }
    }
}
