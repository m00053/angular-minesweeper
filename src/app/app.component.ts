import { Component, OnInit, OnDestroy, ViewChild, ElementRef, Renderer2, HostListener, ViewEncapsulation, AfterViewInit } from '@angular/core';
import { Subject, Observable, Subscription, timer, BehaviorSubject } from 'rxjs';
import { takeUntil, distinctUntilChanged, filter, skip, delay, take } from 'rxjs/operators';
import { MinesweeperService } from './core/minesweeper.service';
import { ScoreService } from './core/score.service';
import { GameStatusEnum, EmojisEnum, GameLevelEnum, CellCodeEnum } from './enums';
import { ICellStructure as ICellData, IBoardData } from './interfaces';
import { AROUND_CELL_OPERATORS } from './consts';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    encapsulation: ViewEncapsulation.None
})
export class AppComponent implements OnInit, OnDestroy, AfterViewInit {
    @ViewChild('boardDOM') boardDOM: ElementRef;
    @ViewChild('resetButton') resetButton: ElementRef;
    @ViewChild('boardFace') boardFace: ElementRef;
    @ViewChild('commandsModalButton') commandsModalButton: ElementRef;
    @ViewChild('commandsButton') commandsButton: ElementRef;

    @HostListener('document:keydown.escape') onKeydown() {
        if (this._gameCommandsModalIsOpen$.value) {
            this.toggleGameCommandsModal();
        }
    }

    boardParsed: ICellData[][] = [];
    gameLevel: GameLevelEnum;
    gameStatus: string | undefined;
    flagsAvailable$: Observable<number>;
    timer: number = 0;
    emojiFace$ = this._minesweeper.emojiFace$;
    gameCommandsModalIsOpen: boolean;

    private _gameCommandsModalIsOpen$ = new BehaviorSubject(false);
    private _horizontal: number;
    private _vertical: number;
    private _minesLength: number;
    private _gameLevel$ = new BehaviorSubject<GameLevelEnum>(GameLevelEnum.Easy);
    private _timerSub: Subscription;
    private _unsubscribeAll: Subject<any>;

    constructor(
        private _minesweeper: MinesweeperService,
        private _score: ScoreService,
        private _renderer2: Renderer2,
    ) {
        this._unsubscribeAll = new Subject();
    }

    ngOnInit(): void {
        this._minesweeper.boardHasChanded$.subscribe((boardData: IBoardData) => {
            this._parseBoard(boardData.board);

            if (!boardData.isBoardReseted) {
                this._minesweeper.firstCellIsReadyToOpen = true;
            }
        });

        this._gameLevel$
            .pipe(takeUntil(this._unsubscribeAll))
            .subscribe(gameLevelSelected => {
                if (gameLevelSelected === GameLevelEnum.Easy) {
                    this._vertical = 9;
                    this._horizontal = 9;
                    this._minesLength = 10;
                } else if (gameLevelSelected === GameLevelEnum.Medium) {
                    this._vertical = 16;
                    this._horizontal = 16;
                    this._minesLength = 40;
                } else if (gameLevelSelected === GameLevelEnum.Hard) {
                    this._vertical = 16;
                    this._horizontal = 30;
                    this._minesLength = 99;
                }

                this.gameLevel = gameLevelSelected;
                this.createNewEmptyBoard();
                this.flagsAvailable$ = this._minesweeper.flagsAvailable$;
            });

        this._minesweeper.gameStatus$
            .pipe(takeUntil(this._unsubscribeAll))
            .subscribe((status: GameStatusEnum | undefined) => {
                if (status === GameStatusEnum.Running) {
                    this._minesweeper.setEmojiFace(EmojisEnum.GrinningFace);
                    this._startTimer();
                } else if (status === GameStatusEnum.Lost || status === GameStatusEnum.Won) {
                    this._unsubscribeTimer();

                    if (status === GameStatusEnum.Won) {
                        this._score.manageBestScores(this.gameLevel, this.timer);
                        this._minesweeper.setEmojiFace(EmojisEnum.SmilingFaceWithSunglasses);
                        this._minesweeper.setFlagsAvailable(0);
                    }

                    if (status == GameStatusEnum.Lost) {
                        this._minesweeper.setEmojiFace(EmojisEnum.NauseatedFace);
                    }
                }

                this.gameStatus = status;
            });

        this._minesweeper.remainingEmptyCells$
            .pipe(
                takeUntil(this._unsubscribeAll),
                distinctUntilChanged(),
                filter(length => length === 0)
            )
            .subscribe(() => this._minesweeper.setGameStatus(GameStatusEnum.Won));        
    }

    ngAfterViewInit(): void {
        this._gameCommandsModalIsOpen$
            .pipe(skip(1))
            .subscribe(state => {
                this.gameCommandsModalIsOpen = state;
                this._renderer2[state ? 'addClass' : 'removeClass'](document.body, 'overflow-hidden');

                if (this.gameCommandsModalIsOpen) {
                    setTimeout(this.commandsModalButton.nativeElement.focus(), 200);
                } else {
                    setTimeout(this.commandsButton.nativeElement.focus(), 200);
                }
            });
    }

    ngOnDestroy(): void {
        this._unsubscribeAll.next();
        this._unsubscribeAll.complete();
        this._timerSub.unsubscribe();
    }

    createNewEmptyBoard(): void {
        this._minesweeper.newEmptyBoard(this._vertical, this._horizontal, this._minesLength);
        this._minesweeper.isFirstClickInCell = true;
        this._unsubscribeTimer();
        this.timer = 0;
    }

    onOpenCell(clickedCellCoord: number[]): void {
        if (this._minesweeper.isFirstClickInCell) {
            this._minesweeper.firstCellIsReadyToOpen$
                .pipe(take(1), delay(50))
                .subscribe(() => this._openCell(clickedCellCoord));
            this._minesweeper.isFirstClickInCell = false;
            this._minesweeper.populateEmptyBoard(clickedCellCoord);
        }
        else if (this._isCellOpened(clickedCellCoord)) {
            this._manageCellsAround(clickedCellCoord);
        }
        else {
            this._openCell(clickedCellCoord);
        }
    }

    onChangeGameLevel(levelSelected: GameLevelEnum): void {
        this._gameLevel$.next(levelSelected);
    }

    toggleGameCommandsModal(event?: Event): void {
        if (event && event.target !== event.currentTarget) {
            return;
        }

        this._gameCommandsModalIsOpen$.next(!this.gameCommandsModalIsOpen);
    }

    onCommandsModalButtonKeydown(event: KeyboardEvent) {
        if (event.key === 'Tab' || event.shiftKey && event.key === 'Tab') {
            event.preventDefault();
        }
    }

    onContextMenu(event) {
        event.preventDefault();

        return false;
    }

    trackByRow(index: number, element: ICellData[]): number {
        return index;
    }

    trackByCell(index: number, element: ICellData): number {
        return element.i;
    }

    private _parseBoard(board: number[][]): void {
        this.boardParsed = [];
        for (let y = 0; y < board.length; y++) {
            const row: ICellData[] = [];

            for (let x = 0; x < board[y].length; x++) {
                row.push({
                    type: board[y][x],
                    y: y,
                    x: x,
                    i: (y * this._horizontal) + x,
                    label: '',
                    isOpened: false,
                    isMine: false,
                    isMineExploded: false,
                });
            }

            this.boardParsed.push(row);
        }
    }

    private _startTimer(): void {
        if (!this._timerSub) {
            this._timerSub = timer(0, 1000).subscribe((second: number) => this.timer = second);
        }
    }

    private _unsubscribeTimer(): void {
        if (this._timerSub) {
            this._timerSub.unsubscribe();
            this._timerSub = null;
        }
    }

    private _openCell(clickedCellCoord: number[]): void {
        const cellData = this._getCellDataByCoord(clickedCellCoord);

        if (cellData.type === CellCodeEnum.Mine) {
            cellData.isMineExploded = true;
            this._minesweeper.setGameStatus(GameStatusEnum.Lost);

            return;
        }

        this._minesweeper.setGameStatus(GameStatusEnum.Running);

        cellData.isOpened = true;

        if (cellData.type === 0) {
            this._openCellsAroundZero(cellData);
            this._updateRemainingEmptyCells();
        } else {
            cellData.label = cellData.type.toString();
            cellData.openedIdClassName = `opened-${cellData.type}`;
            this._minesweeper.decreaseRemainingEmptyCells(1);
        }
    }

    private _updateRemainingEmptyCells(): void {
        const minesweeper = this._minesweeper;
        const allOpenedCells = this._findAllCellDataByKeyValeu("isOpened", true);
        const remainEmptyCells = minesweeper.vertical * minesweeper.horizontal - (minesweeper.minesLenght + allOpenedCells.length);

        minesweeper.setRemainEmptyCells(remainEmptyCells);
    }

    private _openCellsAroundZero(clickedCellData: ICellData): void {
        clickedCellData.isCenterZero = true;

        while (clickedCellData) {
            clickedCellData.openedIdClassName = "";

            for (let i = 0; i < AROUND_CELL_OPERATORS.length; i++) {
                const cellAroundCoords = this._getCellAroundCoordByCenterCellCoord(i, [clickedCellData.y, clickedCellData.x]);

                if (this._isThereCellAround(cellAroundCoords)) {
                    const cellAroundData = this._getCellDataByCoord(cellAroundCoords);

                    if (cellAroundData.label !== CellCodeEnum.Flag) {
                        if (cellAroundData.type === 0) {
                            if (!cellAroundData.isCenterZero) {
                                cellAroundData.isOpened = true;
                                cellAroundData.openedIdClassName = "opened-0";
                            }
                        } else if (!cellAroundData.isOpened) {
                            cellAroundData.label = cellAroundData.type.toString();
                            cellAroundData.isOpened = true;
                            cellAroundData.openedIdClassName = `opened-${cellAroundData.type}`;
                        }
                    }
                }
            }

            clickedCellData = this._findCellDataByKeyValue("openedIdClassName", "opened-0");

            if (clickedCellData) {
                clickedCellData.isCenterZero = true;
            }
        }
    }

    private _isCellOpened(cellCoord) {
        return this._getCellDataByCoord(cellCoord).isOpened;
    }

    private _manageCellsAround(clickedCellCoord: number[]): void {
        const cellData = this._getCellDataByCoord(clickedCellCoord);
        const cellType = (cellData.type as number);

        if (!isNaN(cellType) && cellType != 0) {
            let flagsAroundLength = this._getFlagsAroundLength(clickedCellCoord);

            if (cellType === flagsAroundLength) {
                this._openCellsAround(clickedCellCoord);
            }
        }
    }

    private _getFlagsAroundLength(clickedCellCoord: number[]): number {
        let flagsAroundLength = 0;

        for (let i = 0; i < AROUND_CELL_OPERATORS.length; i++) {
            const cellAroundCoords = this._getCellAroundCoordByCenterCellCoord(i, clickedCellCoord);

            if (this._isThereCellAround(cellAroundCoords)) {
                const cellAroundData = this._getCellDataByCoord(cellAroundCoords);

                if (cellAroundData.label === CellCodeEnum.Flag) {
                    flagsAroundLength++;
                }
            }
        }

        return flagsAroundLength;
    }

    private _getCellAroundCoordByCenterCellCoord(index: number, centerCellCoord: number[]): number[] {
        const aroundGetter = AROUND_CELL_OPERATORS[index];
        const cellAroundY = centerCellCoord[0] + aroundGetter[0];
        const cellAroundX = centerCellCoord[1] + aroundGetter[1];

        return [cellAroundY, cellAroundX];
    }

    private _openCellsAround(clickedCellCoord: number[]) {
        let willLost = false;

        for (let i = 0; i < AROUND_CELL_OPERATORS.length; i++) {
            const cellAroundCoords = this._getCellAroundCoordByCenterCellCoord(i, clickedCellCoord);

            if (this._isThereCellAround(cellAroundCoords)) {
                const cellAroundData = this._getCellDataByCoord(cellAroundCoords);

                if (cellAroundData.label === CellCodeEnum.Flag || cellAroundData.isOpened) {
                    continue;
                }

                if (cellAroundData.type === CellCodeEnum.Mine && !willLost) {
                    willLost = true;

                    continue;
                }

                this._openCell(cellAroundCoords);
            }
        }

        if (willLost) {
            this._minesweeper.setGameStatus(GameStatusEnum.Lost);
        }
    }

    private _isThereCellAround(cellAroundCoords: number[]): boolean {
        return cellAroundCoords[0] >= 0 && cellAroundCoords[0] < this._minesweeper.vertical &&
            cellAroundCoords[1] >= 0 && cellAroundCoords[1] < this._minesweeper.horizontal;
    }

    private _findCellDataByKeyValue(key: string, value: any): ICellData {
        for (let y = 0; y < this.boardParsed.length; y++) {
            const row = this.boardParsed[y];
            const cellData = row.find(cell => cell[key] === value);

            if (cellData) {
                return cellData;
            }
        }

        return undefined;
    }

    private _findAllCellDataByKeyValeu(key: string, value: any): ICellData[] {
        let finalArr = [];
        for (let y = 0; y < this.boardParsed.length; y++) {
            const row = this.boardParsed[y];
            const filteredRow = row.filter(cell => cell[key] === value);

            if (filteredRow.length) {
                for (let i = 0; i < filteredRow.length; i++) {
                    finalArr.push(filteredRow[i]);
                }
            }
        }

        return finalArr;
    }

    private _getCellDataByCoord(cellCoord: number[]): ICellData {
        return this.boardParsed[cellCoord[0]][cellCoord[1]];
    }
}
