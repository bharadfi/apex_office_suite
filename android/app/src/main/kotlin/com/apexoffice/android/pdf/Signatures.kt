package com.apexoffice.android.pdf

import android.content.Context
import org.bouncycastle.asn1.ASN1InputStream
import org.bouncycastle.asn1.ASN1UTCTime
import org.bouncycastle.asn1.ASN1GeneralizedTime
import org.bouncycastle.asn1.BERTags
import org.bouncycastle.asn1.cms.CMSAttributes
import org.bouncycastle.asn1.cms.ContentInfo
import org.bouncycastle.asn1.x500.RDN
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.asn1.x500.style.BCStyle
import org.bouncycastle.cert.X509CertificateHolder
import org.bouncycastle.cms.CMSProcessableByteArray
import org.bouncycastle.cms.CMSSignedData
import org.bouncycastle.cms.SignerInformation
import org.bouncycastle.cms.jcajce.JcaSimpleSignerInfoVerifierBuilder
import org.bouncycastle.jce.provider.BouncyCastleProvider
import java.security.MessageDigest
import java.text.DateFormat
import java.util.Date

enum class Verdict { VALID_TRUSTED, VALID_UNTRUSTED, VALID_MODIFIED, INVALID, UNREADABLE }

class SignatureInfo(
    val index: Int,
    val signer: String,
    val issuer: String,
    val signedAt: Date?,
    val fingerprint: String,
    val verdict: Verdict,
    /** false when more bytes follow the signed range (edits or later signatures) */
    val coversWholeFile: Boolean,
    val detail: String?,
) {
    /** the signer's e-mail address from the certificate, when it has one */
    var email: String? = null

    /** the four numbers of the signature's /ByteRange; identifies its form field */
    var byteRange: List<Long> = emptyList()

    val label: String
        get() = when (verdict) {
            Verdict.VALID_TRUSTED -> "Valid, signer trusted"
            Verdict.VALID_UNTRUSTED -> "Valid, signer not trusted yet"
            Verdict.VALID_MODIFIED -> "Valid, but the file changed after signing"
            Verdict.INVALID -> "Invalid: the document was altered"
            Verdict.UNREADABLE -> "Signature could not be read"
        }

    val signedText: String
        get() = signedAt?.let { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(it) } ?: "time not recorded"
}

/** Certificates the user chose to trust, kept as SHA-256 fingerprints. */
class TrustStore(context: Context) {
    private val prefs = context.getSharedPreferences("trusted_certs", Context.MODE_PRIVATE)
    fun all(): Set<String> = prefs.getStringSet("sha256", emptySet()) ?: emptySet()
    fun trust(fingerprint: String) = prefs.edit().putStringSet("sha256", all() + fingerprint).apply()
    fun untrust(fingerprint: String) = prefs.edit().putStringSet("sha256", all() - fingerprint).apply()
}

/**
 * Reads the signatures of a PDF from its raw bytes. The signed ranges and the signature
 * container are not encrypted, so password-protected files verify without the password.
 */
object SignatureVerifier {
    private val byteRange = Regex("/ByteRange\\s*\\[\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*]")

    fun verify(bytes: ByteArray, trusted: Set<String>): List<SignatureInfo> {
        val text = String(bytes, Charsets.ISO_8859_1)
        val out = ArrayList<SignatureInfo>()
        for ((n, m) in byteRange.findAll(text).withIndex()) {
            val (a, b, c, d) = m.groupValues.drop(1).map { it.toLongOrNull() ?: -1L }
            val legacy = legacyCertificates(text, m.range.first, m.range.last)
            out.add(one(n + 1, bytes, a, b, c, d, trusted, legacy).also { it.byteRange = listOf(a, b, c, d) })
        }
        return out
    }

    private fun unreadable(i: Int, why: String) =
        SignatureInfo(i, "Unknown signer", "", null, "", Verdict.UNREADABLE, false, why)

    private fun one(i: Int, bytes: ByteArray, a: Long, b: Long, c: Long, d: Long, trusted: Set<String>, legacy: List<ByteArray>?): SignatureInfo {
        if (a != 0L || b <= 0 || c < b || c + d > bytes.size) return unreadable(i, "Invalid byte range")
        // the hex string sits in the gap: <...>
        var start = b.toInt()
        var end = c.toInt()
        if (bytes[start] == '<'.code.toByte()) start++
        if (end > start && bytes[end - 1] == '>'.code.toByte()) end--
        val container = hexToBytes(bytes, start, end) ?: return unreadable(i, "Signature data is not valid")
        val signed = ByteArray((b + d).toInt())
        System.arraycopy(bytes, 0, signed, 0, b.toInt())
        System.arraycopy(bytes, c.toInt(), signed, b.toInt(), d.toInt())
        val whole = c + d == bytes.size.toLong() || bytes.copyOfRange((c + d).toInt(), bytes.size).all { it in WHITESPACE }
        if (legacy != null) return oneLegacy(i, container, signed, whole, legacy, trusted)
        return try {
            val info = ContentInfo.getInstance(ASN1InputStream(container).readObject())
            val cms = CMSSignedData(CMSProcessableByteArray(signed), info)
            val signer: SignerInformation = cms.signerInfos.signers.firstOrNull() ?: return unreadable(i, "No signer found")
            @Suppress("UNCHECKED_CAST")
            val matches = cms.certificates.getMatches(signer.sid as org.bouncycastle.util.Selector<X509CertificateHolder>)
            val holder = matches.firstOrNull() ?: return unreadable(i, "Signer certificate is missing")
            val fingerprint = sha256(holder.encoded)
            var why: String? = null
            var integrity = try {
                signer.verify(JcaSimpleSignerInfoVerifierBuilder().setProvider(BouncyCastleProvider()).build(holder))
            } catch (e: Exception) {
                why = e.javaClass.simpleName + ": " + e.message
                false
            }
            // some signers write the signed attributes unsorted; check the signature over them as stored
            if (!integrity && lenientRsa(signer, holder, signed)) { integrity = true; why = null }
            val time = signingTime(signer)
            // trusted when the signer's certificate, or a certificate that issued it, was trusted by the user
            val chain = chainFingerprints(holder, cms.certificates.getMatches(null).map { it as X509CertificateHolder })
            val isTrusted = chain.any { it in trusted }
            val verdict = when {
                !integrity -> Verdict.INVALID
                !isTrusted -> Verdict.VALID_UNTRUSTED
                !whole -> Verdict.VALID_MODIFIED
                else -> Verdict.VALID_TRUSTED
            }
            SignatureInfo(i, commonName(holder.subject), commonName(holder.issuer), time, fingerprint, verdict, whole, if (verdict == Verdict.INVALID) (why ?: "The signature does not match the signed bytes") else null)
                .also { it.email = emailOf(holder) }
        } catch (e: Exception) {
            unreadable(i, e.message ?: "Signature format not supported")
        }
    }

    private val legacyFilter = Regex("/SubFilter\\s*/adbe\\.x509\\.rsa_sha1")

    /**
     * For the original (PDF 1.2) signature format, the certificates held in the signature's /Cert
     * entry (signer first); null for every other format. The entry is a hex or literal string, or an
     * array of them, read from the file as written.
     */
    private fun legacyCertificates(text: String, from: Int, to: Int): List<ByteArray>? {
        val begin = text.lastIndexOf("obj", from).coerceAtLeast(0)
        val finish = text.indexOf("endobj", to).let { if (it < 0) text.length else it }
        val dict = text.substring(begin, finish)
        if (!legacyFilter.containsMatchIn(dict)) return null
        val cert = Regex("/Cert(?![A-Za-z])\\s*").find(dict) ?: return emptyList()
        return readStrings(dict, cert.range.last + 1)
    }

    private fun readStrings(s: String, start: Int): List<ByteArray> {
        var i = start
        fun skipSpace() { while (i < s.length && s[i].isWhitespace()) i++ }
        fun hex(): ByteArray? {
            val end = s.indexOf('>', i)
            if (end < 0) return null
            val digits = s.substring(i + 1, end).filter { !it.isWhitespace() }.let { if (it.length % 2 == 1) it + "0" else it }
            i = end + 1
            return ByteArray(digits.length / 2) { k -> digits.substring(2 * k, 2 * k + 2).toInt(16).toByte() }
        }
        fun literal(): ByteArray {
            val buf = java.io.ByteArrayOutputStream()
            var depth = 1
            i++
            while (i < s.length && depth > 0) {
                val ch = s[i]
                when {
                    ch == '\\' -> {
                        i++
                        val n = s.getOrNull(i) ?: break
                        when (n) {
                            'n' -> buf.write(10)
                            'r' -> buf.write(13)
                            't' -> buf.write(9)
                            'b' -> buf.write(8)
                            'f' -> buf.write(12)
                            '\r' -> if (s.getOrNull(i + 1) == '\n') i++
                            '\n' -> {}
                            in '0'..'7' -> {
                                var v = n - '0'
                                var k = 0
                                while (k < 2 && s.getOrNull(i + 1)?.let { it in '0'..'7' } == true) { i++; v = v * 8 + (s[i] - '0'); k++ }
                                buf.write(v and 0xFF)
                            }
                            else -> buf.write(n.code and 0xFF)
                        }
                    }
                    ch == '(' -> { depth++; buf.write('('.code) }
                    ch == ')' -> { depth--; if (depth > 0) buf.write(')'.code) }
                    ch == '\r' -> { buf.write(10); if (s.getOrNull(i + 1) == '\n') i++ }
                    else -> buf.write(ch.code and 0xFF)
                }
                i++
            }
            return buf.toByteArray()
        }
        fun item(): ByteArray? {
            skipSpace()
            return when (s.getOrNull(i)) { '<' -> hex(); '(' -> literal(); else -> null }
        }
        skipSpace()
        val out = ArrayList<ByteArray>()
        if (s.getOrNull(i) == '[') {
            i++
            while (true) { out.add(item() ?: break) }
        } else {
            item()?.let(out::add)
        }
        return out
    }

    /**
     * A signature in the original format: a bare RSA PKCS#1 v1.5 signature (a DER OCTET STRING holding
     * it, or the value itself) over the SHA-1 of the signed ranges, made with the first certificate in /Cert.
     */
    private fun oneLegacy(i: Int, container: ByteArray, signed: ByteArray, whole: Boolean, certs: List<ByteArray>, trusted: Set<String>): SignatureInfo {
        val factory = java.security.cert.CertificateFactory.getInstance("X.509")
        val parsed = certs.mapNotNull { der ->
            runCatching { factory.generateCertificate(der.inputStream()) as java.security.cert.X509Certificate }.getOrNull()
        }
        val leaf = parsed.firstOrNull() ?: return unreadable(i, "Signer certificate is missing")
        val signature = try {
            if (container.firstOrNull() == 0x04.toByte()) (ASN1InputStream(container).readObject() as org.bouncycastle.asn1.ASN1OctetString).octets
            else {
                val size = ((leaf.publicKey as? java.security.interfaces.RSAPublicKey)?.modulus?.bitLength() ?: 0).let { (it + 7) / 8 }
                if (size in 1..container.size) container.copyOfRange(0, size) else container
            }
        } catch (e: Exception) {
            return unreadable(i, "Signature data is not valid")
        }
        val intact = runCatching {
            java.security.Signature.getInstance("SHA1withRSA").run { initVerify(leaf.publicKey); update(signed); verify(signature) }
        }.getOrDefault(false)
        val holder = X509CertificateHolder(leaf.encoded)
        val chain = chainFingerprints(holder, parsed.map { X509CertificateHolder(it.encoded) })
        val verdict = when {
            !intact -> Verdict.INVALID
            chain.none { it in trusted } -> Verdict.VALID_UNTRUSTED
            !whole -> Verdict.VALID_MODIFIED
            else -> Verdict.VALID_TRUSTED
        }
        return SignatureInfo(i, commonName(holder.subject), commonName(holder.issuer), null, sha256(holder.encoded), verdict, whole,
            if (intact) null else "The signature does not match the signed bytes")
            .also { it.email = emailOf(holder) }
    }
    /** Same digest and RSA checks as the strict path, over the signed attributes exactly as they were stored. */
    private fun lenientRsa(signer: SignerInformation, holder: X509CertificateHolder, signed: ByteArray): Boolean = try {
        val attrs = signer.toASN1Structure().authenticatedAttributes
        val digestName = when (signer.digestAlgOID) {
            "1.3.14.3.2.26" -> "SHA1"
            "2.16.840.1.101.3.4.2.1" -> "SHA256"
            "2.16.840.1.101.3.4.2.2" -> "SHA384"
            "2.16.840.1.101.3.4.2.3" -> "SHA512"
            else -> null
        }
        if (attrs == null || digestName == null || !signer.encryptionAlgOID.startsWith("1.2.840.113549.1.1.")) {
            false
        } else {
            val claimed = org.bouncycastle.asn1.cms.AttributeTable(attrs)
                .get(org.bouncycastle.asn1.cms.CMSAttributes.messageDigest)?.attrValues?.getObjectAt(0)
                ?.let { (it as org.bouncycastle.asn1.ASN1OctetString).octets }
            val actual = java.security.MessageDigest.getInstance(digestName.replace("SHA", "SHA-").replace("SHA-1", "SHA-1")).digest(signed)
            if (claimed == null || !java.security.MessageDigest.isEqual(claimed, actual)) {
                false
            } else {
                val key = java.security.cert.CertificateFactory.getInstance("X.509")
                    .generateCertificate(holder.encoded.inputStream()).publicKey
                java.security.Signature.getInstance(digestName + "withRSA").run {
                    initVerify(key)
                    update(attrs.encoded)
                    verify(signer.signature)
                }
            }
        }
    } catch (e: Exception) {
        false
    }

    /** The e-mail address in the certificate: the subject alternative name, else the subject's E field. */
    private fun emailOf(holder: X509CertificateHolder): String? = try {
        val alt = holder.extensions?.getExtensionParsedValue(org.bouncycastle.asn1.x509.Extension.subjectAlternativeName)
        val fromAlt = alt?.let { org.bouncycastle.asn1.x509.GeneralNames.getInstance(it).names }
            ?.firstOrNull { it.tagNo == org.bouncycastle.asn1.x509.GeneralName.rfc822Name }
            ?.name?.toString()
        fromAlt ?: holder.subject.getRDNs(BCStyle.E).firstOrNull()?.first?.value?.toString()
    } catch (e: Exception) {
        null
    }

    private val WHITESPACE = setOf(0x0A.toByte(), 0x0D.toByte(), 0x20.toByte(), 0x00.toByte())

    private fun chainFingerprints(leaf: X509CertificateHolder, all: List<X509CertificateHolder>): List<String> {
        val out = arrayListOf(sha256(leaf.encoded))
        var current = leaf
        repeat(6) {
            val issuer = all.firstOrNull { it.subject == current.issuer && it != current } ?: return out
            out.add(sha256(issuer.encoded))
            current = issuer
        }
        return out
    }

    private fun signingTime(signer: SignerInformation): Date? {
        val attr = signer.signedAttributes?.get(CMSAttributes.signingTime) ?: return null
        return when (val v = attr.attrValues.getObjectAt(0)) {
            is ASN1UTCTime -> v.date
            is ASN1GeneralizedTime -> v.date
            else -> null
        }
    }

    private fun commonName(name: X500Name): String {
        val cn = name.getRDNs(BCStyle.CN).firstOrNull() as RDN?
        val o = name.getRDNs(BCStyle.O).firstOrNull() as RDN?
        return (cn ?: o)?.first?.value?.toString() ?: name.toString()
    }

    private fun sha256(data: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }

    private fun hexToBytes(src: ByteArray, from: Int, to: Int): ByteArray? {
        val out = java.io.ByteArrayOutputStream((to - from) / 2)
        var hi = -1
        for (k in from until to) {
            val v = Character.digit(src[k].toInt().toChar(), 16)
            if (v < 0) continue
            if (hi < 0) hi = v else { out.write(hi * 16 + v); hi = -1 }
        }
        return if (out.size() == 0) null else out.toByteArray()
    }
}
