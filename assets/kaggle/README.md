Fill this directory with this dataset


```pwsh
# From the repository root
mkdir -Force assets/kaggle

# Ensure Kaggle CLI can run
python -m kaggle --help > $null

# Download and unzip (≈52 MB compressed)
python -m kaggle datasets download trainingdatapro/ocr-receipts-text-detection -p assets/kaggle --unzip

# Expected layout after extraction:
# assets/kaggle/
#   images/0.jpg ... images/19.jpg
#   annotations.xml
#   boxes/ (optional helper visuals)
```