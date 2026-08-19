"""
Stand-alone downloader for the local voice model (ai4bharat/indic-parler-tts).

Run this once, before starting the server, to fetch and cache the model
weights (a few GB) from Hugging Face:

    cd "05. XYZ AI Repository/xyz-ai/backend"
    pip install -r requirements.txt
    python download_tts_model.py

The backend itself (backend/tts.py) never downloads weights at request or
startup time - it only ever loads them from the local Hugging Face cache
(local_files_only=True). If you skip this script, or it hasn't finished
yet, voice replies just fall back to the browser's built-in speech
synthesis; nothing else breaks - see backend/tts.py for that fallback.

Safe to re-run any time: Hugging Face skips any files that are already
cached, so a second run finishes in a couple of seconds.

Set INDIC_TTS_MODEL in backend/.env to point at a different checkpoint if
you don't want the default.
"""
import os
import sys

MODEL_ID = os.environ.get("INDIC_TTS_MODEL", "ai4bharat/indic-parler-tts")


def main() -> None:
    try:
        from parler_tts import ParlerTTSForConditionalGeneration
        from transformers import AutoTokenizer
    except ImportError:
        print(
            "Missing dependencies. Install them first:\n"
            "  pip install -r requirements.txt",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Downloading/caching {MODEL_ID} (first run: a few GB, can take several minutes)...")

    model = ParlerTTSForConditionalGeneration.from_pretrained(MODEL_ID)
    AutoTokenizer.from_pretrained(MODEL_ID)
    AutoTokenizer.from_pretrained(model.config.text_encoder._name_or_path)

    print(f"Done. {MODEL_ID} is cached locally - the server will load it from disk, no network needed.")


if __name__ == "__main__":
    main()
