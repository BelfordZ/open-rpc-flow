#!/bin/bash

# Script to replace console.log, console.error, console.warn, and console.assert
# with TestLogger equivalent calls in all test files

echo "Starting console log replacement..."

# Find all test files, excluding logger.test.ts
TEST_FILES=$(find src/__tests__/ -name "*.test.ts" | grep -v "logger.test.ts")

# Counter for processed files
PROCESSED=0
MODIFIED=0

for file in $TEST_FILES; do
  PROCESSED=$((PROCESSED+1))
  
  # Check if file contains console.log, console.error, console.warn, or console.assert
  if grep -q "console\.\(log\|error\|warn\|assert\|debug\|info\)" "$file"; then
    echo "Processing $file..."
    
    # Check if file has TestLogger import
    if ! grep -q "import { TestLogger }" "$file" && ! grep -q "import .*TestLogger" "$file"; then
      # Add TestLogger import if not present
      sed -i '1s/^/import { TestLogger } from '\''..\/..\/util\/logger'\'';\n/' "$file"
      echo "  Added TestLogger import"
    fi
    
    # Check if logger instance exists
    if ! grep -q "const logger = new TestLogger" "$file" && ! grep -q "let logger: TestLogger" "$file" && ! grep -q "logger = new TestLogger" "$file"; then
      # Add logger instance before first describe block
      sed -i '/describe(/i\const logger = new TestLogger('\''TestLoggerAutoAdded'\'');\n' "$file"
      echo "  Added logger instance"
    fi
    
    # Replace console.log with logger.log
    sed -i 's/console\.log/logger.log/g' "$file"
    
    # Replace console.error with logger.error
    sed -i 's/console\.error/logger.error/g' "$file"
    
    # Replace console.warn with logger.warn
    sed -i 's/console\.warn/logger.warn/g' "$file"
    
    # Replace console.debug with logger.debug
    sed -i 's/console\.debug/logger.debug/g' "$file"
    
    # Replace console.info with logger.log (since TestLogger doesn't have info)
    sed -i 's/console\.info/logger.log/g' "$file"
    
    # Handle console.assert specifically
    if grep -q "console\.assert" "$file"; then
      # Replace console.assert with conditional logger.error
      sed -i 's/console\.assert(\([^,]*\), \(.*\));/if (!(\1)) { logger.error(\2); }/g' "$file"
      # Handle single-argument console.assert (unlikely but possible)
      sed -i 's/console\.assert(\([^)]*\));/if (!(\1)) { logger.error("Assertion failed: " + \1); }/g' "$file"
    fi
    
    MODIFIED=$((MODIFIED+1))
    echo "  Modified $file"
  fi
done

echo "Completed! Modified $MODIFIED out of $PROCESSED files." 