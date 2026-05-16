from __future__ import annotations

import csv
import re
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
PDF_DIR = Path("/Users/mr.mao/Downloads/english_vocab_pdfs_bundle 2")
CET_DIR = Path("/Users/mr.mao/Downloads/cet4_cet6_vocab_bundle")
OUT_DIR = ROOT / "data" / "vocab-categories"
DICT_PATH = ROOT / "data" / "ecdict.full.csv"

POS_WORDS = {
    "a",
    "ad",
    "adv",
    "abbr",
    "aux",
    "conj",
    "int",
    "n",
    "num",
    "pl",
    "prep",
    "pron",
    "v",
    "vi",
    "vt",
    "am",
    "is",
    "are",
    "be",
}

SOURCES = {
    "compulsory": "01_yewu_yingyu_2022_searchable.pdf",
    "high_school": "02_gaozhong_yingyu_2017_2020.pdf",
    "gaokao_3500": "03_gaokao_yingyu_3500_kaogang.pdf",
    "cet": "CET4_CET6_Official_Vocab_Pages_2016.pdf",
}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dictionary_words = load_dictionary_words()
    max_word_len = max(map(len, dictionary_words))

    cet4, cet6 = extract_cet_words(dictionary_words)
    extracted = {
        "level_2": extract_compulsory_section(dictionary_words, max_word_len, "二级词汇表", "三级词汇表"),
        "level_3": extract_compulsory_section(dictionary_words, max_word_len, "三级词汇表", "月份、星期词汇表"),
        "high_school": extract_line_based(SOURCES["high_school"], "abandon", "附录 3 语法项目"),
        "gaokao_3500": extract_line_based(SOURCES["gaokao_3500"], "A", ""),
        "cet4": cet4,
        "cet6": cet6,
    }

    for name, words in extracted.items():
        cleaned = sorted({word for word in words if word in dictionary_words and word not in POS_WORDS})
        (OUT_DIR / f"{name}.txt").write_text("\n".join(cleaned) + "\n", encoding="utf-8")
        print(f"{name}: {len(cleaned)} words")
        print("  sample:", ", ".join(cleaned[:24]))


def load_dictionary_words() -> set[str]:
    words: set[str] = set()
    with DICT_PATH.open("r", encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        for row in reader:
            original = (row.get("word") or "").strip()
            word = original.lower()
            if re.fullmatch(r"[a-z]{2,32}", original):
                words.add(word)
    return words


def pdf_text(file_name: str) -> str:
    reader = PdfReader(str(PDF_DIR / file_name))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def extract_compulsory_section(dictionary_words: set[str], max_word_len: int, start_marker: str, end_marker: str) -> set[str]:
    text = pdf_text(SOURCES["compulsory"])
    start = text.find(start_marker)
    end = text.find(end_marker, start + len(start_marker))
    if start == -1:
        raise RuntimeError(f"Could not find compulsory vocabulary section: {start_marker}")
    section = text[start : end if end != -1 else len(text)]
    section = section.split("本词汇表不列可根据构词法推导出的部分名词、形容词、副", 1)[-1]
    section = re.sub(r"（[^）]*）|\([^)]*\)", " ", section)
    words: set[str] = set()
    for raw_line in section.splitlines():
        line = raw_line.strip()
        if not line or re.search(r"词汇表|说明|附录|义务教育|课程标准|^[A-Z]$", line):
            continue
        for chunk in line.split():
            if re.search(r"[a-z][A-Z]$", chunk):
                chunk = chunk[:-1]
            normalized = re.sub(r"[^A-Za-z]", "", chunk).lower()
            if not normalized:
                continue
            words.update(segment_compacted_words(normalized, dictionary_words, max_word_len))
    return words


def segment_compacted_words(text: str, dictionary_words: set[str], max_word_len: int) -> list[str]:
    result: list[str] = []
    index = 0
    while index < len(text):
        match = ""
        max_len = min(max_word_len, len(text) - index)
        for length in range(max_len, 1, -1):
            candidate = text[index : index + length]
            if candidate in dictionary_words and candidate not in POS_WORDS:
                match = candidate
                break
        if match:
            result.append(match)
            index += len(match)
        else:
            index += 1
    return result


def extract_line_based(file_name: str, start_marker: str, end_marker: str) -> set[str]:
    text = pdf_text(file_name)
    start = text.find(start_marker)
    if start == -1:
        raise RuntimeError(f"Could not find start marker {start_marker!r} in {file_name}")
    end = text.find(end_marker, start) if end_marker else -1
    section = text[start : end if end != -1 else len(text)]
    section = re.sub(r"\([^)]*\)", " ", section)
    words: set[str] = set()
    for token in re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)?", section):
        word = token.lower().strip("-'")
        if word in POS_WORDS:
            continue
        if re.fullmatch(r"[a-z]{2,32}", word):
            words.add(word)
    return words


def extract_cet_words(dictionary_words: set[str]) -> tuple[set[str], set[str]]:
    text = pdf_text_from_path(CET_DIR / SOURCES["cet"])
    start = text.find("a/an")
    if start == -1:
      raise RuntimeError("Could not find CET vocabulary start")
    section = text[start:]
    cet4: set[str] = set()
    cet6: set[str] = set()
    for raw_line in section.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        target = cet6 if line.startswith("★") else cet4
        line = line.replace("★", " ")
        for raw_token in re.findall(r"[A-Za-z][A-Za-z()/\\-]*", line):
            for word in expand_cet_token(raw_token):
                if word in dictionary_words and word not in POS_WORDS:
                    target.add(word)
    return cet4, cet6


def expand_cet_token(token: str) -> set[str]:
    token = token.strip().lower()
    expanded: set[str] = set()
    for part in re.split(r"/", token):
        part = part.strip("-")
        if not part:
            continue
        optional = re.search(r"^([a-z]+)\\(([a-z]+)\\)([a-z]+)$", part)
        if optional:
            before, middle, after = optional.groups()
            expanded.add(before + after)
            expanded.add(before + middle + after)
        elif re.fullmatch(r"[a-z]{2,32}", part):
            expanded.add(part)
    return expanded


def pdf_text_from_path(path: Path) -> str:
    reader = PdfReader(str(path))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


if __name__ == "__main__":
    main()
