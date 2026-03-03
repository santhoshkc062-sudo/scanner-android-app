import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent {

  ipAddress: string = '';
  isIpSet: boolean = false;

  setIp() {
    if (this.ipAddress.trim() !== '') {
      localStorage.setItem('serverIp', this.ipAddress);
      this.isIpSet = true;
    } else {
      alert('Please enter IP Address');
    }
  }
}