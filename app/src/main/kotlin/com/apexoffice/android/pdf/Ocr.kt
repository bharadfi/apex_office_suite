package com.apexoffice.android.pdf

import android.graphics.Bitmap
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/** On-device text recognition (bundled Latin model; nothing leaves the phone). */
object Ocr {
    private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

    /** Blocking; call from a background thread. */
    fun recognize(bitmap: Bitmap): String {
        val result = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)))
        return result.textBlocks.joinToString("\n\n") { it.text }
    }
}
