<?php
/**
 * @link      https://craftcms.com/
 * @copyright Copyright (c) Pixel & Tonic, Inc.
 * @license   https://craftcms.com/license
 */

namespace craft\db\mysql;

use Craft;
use craft\db\TableSchema;
use craft\errors\DbBackupException;
use craft\helpers\FileHelper;
use craft\services\Config;
use yii\db\Exception;

/**
 * @inheritdoc
 *
 * @author Pixel & Tonic, Inc. <support@pixelandtonic.com>
 * @since  3.0
 */
class Schema extends \yii\db\mysql\Schema
{
    // Constants
    // =========================================================================

    const TYPE_TINYTEXT = 'tinytext';
    const TYPE_MEDIUMTEXT = 'mediumtext';
    const TYPE_LONGTEXT = 'longtext';
    const TYPE_ENUM = 'enum';

    // Properties
    // =========================================================================

    /**
     * @var int The maximum length that objects' names can be.
     */
    public $maxObjectNameLength = 64;

    // Public Methods
    // =========================================================================

    /**
     * @inheritdoc
     */
    public function init()
    {
        parent::init();

        $this->typeMap['tinytext'] = self::TYPE_TINYTEXT;
        $this->typeMap['mediumtext'] = self::TYPE_MEDIUMTEXT;
        $this->typeMap['longtext'] = self::TYPE_LONGTEXT;
        $this->typeMap['enum'] = self::TYPE_ENUM;
    }

    /**
     * Creates a query builder for the database.
     * This method may be overridden by child classes to create a DBMS-specific query builder.
     *
     * @return QueryBuilder query builder instance
     */
    public function createQueryBuilder()
    {
        return new QueryBuilder($this->db);
    }

    /**
     * Quotes a database name for use in a query.
     *
     * @param $name
     *
     * @return string
     */
    public function quoteDatabaseName($name)
    {
        return '`'.$name.'`';
    }

    /**
     * Releases an existing savepoint.
     *
     * @param string $name The savepoint name.
     *
     * @throws Exception
     */
    public function releaseSavepoint($name)
    {
        try {
            parent::releaseSavepoint($name);
        } catch (Exception $e) {
            // Specifically look for a "SAVEPOINT does not exist" error.
            if ($e->getCode() == 42000 && isset($e->errorInfo[1]) && $e->errorInfo[1] == 1305) {
                Craft::warning('Tried to release a savepoint, but it does not exist: '.$e->getMessage(), __METHOD__);
            } else {
                throw $e;
            }
        }
    }

    /**
     * Rolls back to a previously created savepoint.
     *
     * @param string $name The savepoint name.
     *
     * @throws Exception
     */
    public function rollBackSavepoint($name)
    {
        try {
            parent::rollBackSavepoint($name);
        } catch (Exception $e) {
            // Specifically look for a "SAVEPOINT does not exist" error.
            if ($e->getCode() == 42000 && isset($e->errorInfo[1]) && $e->errorInfo[1] == 1305) {
                Craft::warning('Tried to roll back a savepoint, but it does not exist: '.$e->getMessage(), __METHOD__);
            } else {
                throw $e;
            }
        }
    }

    /**
     * @inheritdoc
     */
    public function createColumnSchemaBuilder($type, $length = null)
    {
        return new ColumnSchemaBuilder($type, $length, $this->db);
    }

    /**
     * Returns the default backup command to execute.
     *
     * @return string The command to execute
     */
    public function getDefaultBackupCommand()
    {
        return 'mysqldump'.
            ' --defaults-extra-file='.$this->_createDumpConfigFile().
            ' --add-drop-table'.
            ' --comments'.
            ' --create-options'.
            ' --dump-date'.
            ' --no-autocommit'.
            ' --routines'.
            ' --set-charset'.
            ' --triggers'.
            ' --result-file={file}'.
            ' {database}';
    }

    /**
     * Returns the default database restore command to execute.
     *
     * @return string The command to execute
     * @throws DbBackupException
     */
    public function getDefaultRestoreCommand()
    {
        return 'mysqldump'.
            ' --defaults-extra-file='.$this->_createDumpConfigFile().
            ' {database}'.
            ' < {file}';
    }

    /**
     * Returns all indexes for the given table. Each array element is of the following structure:
     *
     * ```php
     * [
     *     'IndexName1' => ['col1' [, ...]],
     *     'IndexName2' => ['col2' [, ...]],
     * ]
     * ```
     *
     * @param string $tableName The name of the table to get the indexes for.
     *
     * @return array All indexes for the given table.
     */
    public function findIndexes($tableName)
    {
        $tableName = Craft::$app->getDb()->getSchema()->getRawTableName($tableName);
        $table = Craft::$app->getDb()->getSchema()->getTableSchema($tableName);
        $sql = $this->getCreateTableSql($table);
        $indexes = [];

        $regexp = '/KEY\s+([^\(\s]+)\s*\(([^\(\)]+)\)/mi';
        if (preg_match_all($regexp, $sql, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $indexName = str_replace('`', '', $match[1]);
                $indexColumns = array_map('trim', explode(',', str_replace('`', '', $match[2])));
                $indexes[$indexName] = $indexColumns;
            }
        }

        return $indexes;
    }

    /**
     * Loads the metadata for the specified table.
     *
     * @param string $name table name
     *
     * @return TableSchema driver dependent table metadata. Null if the table does not exist.
     */
    protected function loadTableSchema($name)
    {
        $table = new TableSchema;
        $this->resolveTableNames($table, $name);

        if ($this->findColumns($table)) {
            $this->findConstraints($table);

            return $table;
        } else {
            return null;
        }
    }

    // Private Methods
    // =========================================================================

    /**
     * Creates a temporary my.cnf file based on the DB config settings.
     *
     * @return string The path to the my.cnf file
     * @throws DbBackupException if the file cannot be created
     */
    private function _createDumpConfigFile()
    {
        $filePath = Craft::$app->getPath()->getTempPath().'/my.cnf';

        $config = Craft::$app->getConfig();
        $contents = '[client]'.PHP_EOL.
            'user='.$config->get('user', Config::CATEGORY_DB).PHP_EOL.
            'password='.$config->get('password', Config::CATEGORY_DB).PHP_EOL.
            'host='.$config->get('server', Config::CATEGORY_DB).PHP_EOL.
            'port='.$config->getDbPort();

        FileHelper::writeToFile($filePath, $contents);

        return $filePath;
    }
}
