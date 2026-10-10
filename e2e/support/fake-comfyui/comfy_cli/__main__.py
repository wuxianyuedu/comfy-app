"""`python -m comfy_cli` 的入口（见 `__init__.py` 的说明）。"""

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
