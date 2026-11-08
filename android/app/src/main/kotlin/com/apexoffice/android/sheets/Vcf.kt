package com.apexoffice.android.sheets

/** vCard (2.1 / 3.0 / 4.0) to table rows, one contact per row, matching the desktop import's columns. */
object Vcf {
    val columns = listOf(
        "Name", "Given name", "Family name", "Organization", "Title",
        "Phone", "Email", "Address", "Birthday", "Website", "Notes",
    )

    private fun unfold(text: String): List<String> {
        val lines = ArrayList<String>()
        for (line in text.removePrefix("﻿").replace("\r\n", "\n").replace('\r', '\n').split('\n')) {
            val prev = lines.lastOrNull()
            when {
                prev != null && prev.endsWith("=") && Regex("QUOTED-PRINTABLE", RegexOption.IGNORE_CASE).containsMatchIn(prev) ->
                    lines[lines.size - 1] = prev.dropLast(1) + line
                (line.startsWith(" ") || line.startsWith("\t")) && prev != null ->
                    lines[lines.size - 1] = prev + line.drop(1)
                else -> lines.add(line)
            }
        }
        return lines
    }

    private fun decodeQp(value: String, charset: String): String {
        val out = java.io.ByteArrayOutputStream()
        var i = 0
        while (i < value.length) {
            val hex = if (value[i] == '=' && i + 2 < value.length + 0) value.substring(i + 1, minOf(i + 3, value.length)) else null
            if (hex != null && hex.length == 2 && hex.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) {
                out.write(hex.toInt(16)); i += 3
            } else { out.write(value[i].code and 0xFF); i++ }
        }
        return try { String(out.toByteArray(), charset(charset)) } catch (e: Exception) { String(out.toByteArray(), Charsets.UTF_8) }
    }

    private fun unescape(v: String) = v.replace(Regex("\\\\([nN,;\\\\])")) { if (it.groupValues[1].lowercase() == "n") "\n" else it.groupValues[1] }

    private fun splitStructured(v: String): List<String> {
        val parts = ArrayList<String>(); val cur = StringBuilder(); var i = 0
        while (i < v.length) {
            if (v[i] == '\\' && i + 1 < v.length) { cur.append(v[i]).append(v[i + 1]); i += 2 }
            else if (v[i] == ';') { parts.add(cur.toString()); cur.setLength(0); i++ }
            else { cur.append(v[i]); i++ }
        }
        parts.add(cur.toString())
        return parts.map(::unescape)
    }

    fun toRows(text: String): List<List<String>> {
        val rows = ArrayList<List<String>>()
        rows.add(columns)
        var card: MutableMap<String, String>? = null
        fun put(key: String, value: String) {
            val v = value.trim()
            if (v.isEmpty()) return
            val c = card ?: return
            c[key] = if (c[key].isNullOrEmpty()) v else c[key] + "; " + v
        }
        for (line in unfold(text)) {
            val colon = line.indexOf(':')
            if (colon <= 0) continue
            val head = line.substring(0, colon).split(';')
            var name = head[0].uppercase()
            name = name.substringAfter('.', name)
            val params = head.drop(1)
            var value = line.substring(colon + 1)
            if (params.any { it.equals("ENCODING=QUOTED-PRINTABLE", true) || it.equals("QUOTED-PRINTABLE", true) }) {
                value = decodeQp(value, params.firstOrNull { it.startsWith("CHARSET=", true) }?.substring(8) ?: "UTF-8")
            }
            when {
                name == "BEGIN" && value.trim().equals("VCARD", true) -> card = HashMap()
                name == "END" && value.trim().equals("VCARD", true) -> {
                    card?.let { c ->
                        if (c["Name"].isNullOrEmpty()) c["Name"] = listOfNotNull(c["Given name"], c["Family name"]).joinToString(" ")
                        rows.add(columns.map { c[it] ?: "" })
                    }
                    card = null
                }
                card == null -> {}
                name == "FN" -> put("Name", unescape(value))
                name == "N" -> splitStructured(value).let { put("Family name", it.getOrElse(0) { "" }); put("Given name", it.getOrElse(1) { "" }) }
                name == "ORG" -> put("Organization", splitStructured(value).filter { it.isNotEmpty() }.joinToString(", "))
                name == "TITLE" -> put("Title", unescape(value))
                name == "TEL" -> put("Phone", value.removePrefix("tel:"))
                name == "EMAIL" -> put("Email", unescape(value).removePrefix("mailto:"))
                name == "ADR" -> put("Address", splitStructured(value).filter { it.isNotEmpty() }.joinToString(", "))
                name == "BDAY" -> put("Birthday", value)
                name == "URL" -> put("Website", value)
                name == "NOTE" -> put("Notes", unescape(value))
            }
        }
        return rows
    }
}
